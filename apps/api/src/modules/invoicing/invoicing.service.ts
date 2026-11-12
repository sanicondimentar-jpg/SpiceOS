import { Injectable } from '@nestjs/common';
import type { FiscalSettings, Invoice, Prisma } from '@prisma/client';
import type { InvoiceListQuery } from '@spiceos/contracts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/domain/errors';
import { DomainEvent } from '../../shared/domain/domain-event';
import { round2 } from '../../shared/domain/money';
import type { Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork, type UowScope } from '../../shared/unit-of-work';
import { renderPdf } from '../catalog/domain/price-list-pdf';
import { WsfeError, type WsfeClient } from './arca/wsfe';
import { buildInvoiceDoc } from './domain/invoice-pdf';
import {
  KIND_LABEL,
  arcaDate,
  assertReceiverAllowed,
  caeDetail,
  formatInvoiceNumber,
  invoiceAmounts,
  invoiceKind,
  kindForLetter,
  receiverCondition,
  receiverDoc,
  todayAr,
  type Amounts,
  type CaeRequestInput,
  type InvoiceKind,
  type ReceiverCondition,
  type ReceiverDoc,
} from './domain/invoice-rules';
import { FiscalSettingsService } from './fiscal-settings.service';

/** Estados de pedido que se pueden facturar (ya confirmado, no cancelado). */
const INVOICEABLE = ['CONFIRMED', 'PICKING', 'READY', 'DISPATCHED', 'DELIVERED'];

/** La transacción espera a ARCA: login, último número y CAE pueden tardar varios segundos. */
const ARCA_TX_TIMEOUT = 90_000;

interface InvoiceLine {
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  lineTotal: number;
}

/**
 * Emisión de facturas y notas de crédito con CAE de ARCA.
 * La numeración la lleva ARCA: se pide el último autorizado y se solicita el siguiente, con un bloqueo
 * por empresa para que dos personas no facturen el mismo número a la vez. Si ARCA autorizó un
 * comprobante que no llegó a guardarse (se cortó la conexión), al reintentar se recupera en vez de duplicarlo.
 */
@Injectable()
export class InvoicingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly fiscal: FiscalSettingsService,
  ) {}

  async issueForOrder(orderId: string) {
    const settings = await this.fiscal.requireReady();
    const wsfe = await this.fiscal.client(settings);
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      await this.lock(tx);
      await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.salesOrder.findFirst({
        where: { id: orderId },
        include: {
          customer: { include: { addresses: { orderBy: { isDefault: 'desc' }, take: 1 } } },
          lines: { orderBy: { variant: { sku: 'asc' } }, include: { variant: { select: { sku: true, name: true, product: { select: { name: true } } } } } },
        },
      });
      if (!order) throw new NotFoundError('Pedido', orderId);
      if (!INVOICEABLE.includes(order.status)) throw new BusinessRuleError('Solo se pueden facturar pedidos confirmados que no estén cancelados ni facturados');
      const existing = await tx.invoice.findFirst({ where: { orderId, status: { not: 'CANCELLED' }, NOT: { type: { startsWith: 'NC' } } } });
      if (existing) throw new ConflictError(`El pedido ya tiene la ${KIND_LABEL[existing.type]} ${formatInvoiceNumber(existing.pointOfSale, existing.number)}`);
      if (settings.taxCondition === 'RESPONSABLE_INSCRIPTO' && !order.withInvoice) {
        throw new BusinessRuleError('El pedido se cargó sin factura y su precio no incluye IVA; cargalo de nuevo con factura');
      }

      const condition = receiverCondition(order.customer.taxCondition);
      const doc = receiverDoc(order.customer.taxId);
      const kind = invoiceKind(settings.taxCondition, condition);
      this.assertAllowed(kind, doc);
      const amounts = invoiceAmounts(kind.letter, Number(order.total));
      if (amounts.total <= 0) throw new BusinessRuleError('El pedido no tiene importe para facturar');
      const lines: InvoiceLine[] = order.lines.map((l) => ({
        sku: l.variant.sku,
        description: `${l.variant.product.name} ${l.variant.name}`,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountPct: Number(l.discountPct),
        lineTotal: Number(l.lineTotal),
      }));
      const date = todayAr();
      const auth = await this.authorize(tx, wsfe, settings, { kind, pointOfSale: settings.pointOfSale!, date, doc, receiver: condition, amounts });

      const address = order.customer.addresses[0];
      const invoice = await this.save(tx, scope, {
        settings,
        customerId: order.customerId,
        paymentTermsDays: order.customer.paymentTermsDays,
        orderId,
        kind,
        number: auth.number,
        date: auth.date,
        cae: auth.cae,
        caeDueDate: auth.caeDueDate,
        doc,
        condition,
        receiverName: order.customer.legalName,
        receiverAddress: address ? [address.street, address.city, address.province].filter(Boolean).join(', ') : null,
        amounts,
        lines,
      });
      await tx.salesOrder.update({
        where: { id: orderId },
        data: {
          withInvoice: true,
          version: { increment: 1 },
          ...(order.status === 'DELIVERED' && {
            status: 'INVOICED',
            statusHistory: { create: { from: order.status, to: 'INVOICED', changedBy: ctx.actor, reason: `${KIND_LABEL[kind.type]} ${formatInvoiceNumber(invoice.pointOfSale, invoice.number)}` } },
          }),
        },
      });
      return this.summary(invoice);
    }, ARCA_TX_TIMEOUT);
  }

  /** Anula una factura con una nota de crédito por el total (mismo receptor, mismos importes). */
  async creditNote(invoiceId: string, reason: string) {
    const settings = await this.fiscal.requireReady();
    const wsfe = await this.fiscal.client(settings);
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      await this.lock(tx);
      const original = await tx.invoice.findFirst({ where: { id: invoiceId }, include: { allocations: true, account: { select: { customerId: true, customer: { select: { paymentTermsDays: true } } } } } });
      if (!original || original.arcaType === null) throw new NotFoundError('Factura', invoiceId);
      if (original.type.startsWith('NC')) throw new BusinessRuleError('Una nota de crédito no se anula desde acá');
      if (original.status === 'CANCELLED') throw new ConflictError('La factura ya está anulada');
      if (original.allocations.length) throw new BusinessRuleError('La factura tiene cobros imputados; desimputalos antes de anularla');
      if (original.testing !== (settings.environment === 'TESTING')) throw new BusinessRuleError('La factura es de otro ambiente de ARCA (prueba / producción)');

      const letter = original.type.slice(-1) as 'A' | 'B' | 'C';
      const kind = kindForLetter(letter, true);
      const doc: ReceiverDoc = { docType: original.receiverDocType ?? 99, docNumber: original.receiverDocNumber ?? '0' };
      const condition = (original.receiverCondition ?? 'CF') as ReceiverCondition;
      const amounts: Amounts = { net: Number(original.net), vat: Number(original.vat), total: round2(Number(original.total)) };
      const date = todayAr();
      const auth = await this.authorize(tx, wsfe, settings, {
        kind,
        pointOfSale: settings.pointOfSale!,
        date,
        doc,
        receiver: condition,
        amounts,
        associated: { arcaType: original.arcaType, pointOfSale: original.pointOfSale, number: original.number, issuerCuit: settings.cuit, date: original.issueDate.toISOString().slice(0, 10) },
      });
      const note = await this.save(tx, scope, {
        settings,
        customerId: original.account.customerId,
        paymentTermsDays: original.account.customer.paymentTermsDays,
        orderId: original.orderId,
        kind,
        number: auth.number,
        date: auth.date,
        cae: auth.cae,
        caeDueDate: auth.caeDueDate,
        doc,
        condition,
        receiverName: original.receiverName ?? '',
        receiverAddress: original.receiverAddress,
        amounts,
        lines: (original.lines as unknown as InvoiceLine[]) ?? [],
        relatedInvoiceId: original.id,
        reason,
      });
      await tx.invoice.update({ where: { id: original.id }, data: { status: 'CANCELLED', pending: 0 } });
      // El pedido vuelve a "entregado" para poder facturarlo de nuevo si hace falta.
      if (original.orderId) {
        const order = await tx.salesOrder.findFirst({ where: { id: original.orderId }, select: { status: true } });
        if (order?.status === 'INVOICED') {
          await tx.salesOrder.update({
            where: { id: original.orderId },
            data: { status: 'DELIVERED', version: { increment: 1 }, statusHistory: { create: { from: 'INVOICED', to: 'DELIVERED', changedBy: ctx.actor, reason: `Factura anulada: ${reason}` } } },
          });
        }
      }
      return this.summary(note);
    }, ARCA_TX_TIMEOUT);
  }

  list(query: InvoiceListQuery) {
    const like = query.q?.trim();
    return this.uow.read(async (tx) => {
      const rows = await tx.invoice.findMany({
        where: {
          arcaType: { not: null },
          ...((query.from || query.to) && { issueDate: { ...(query.from && { gte: new Date(query.from) }), ...(query.to && { lte: new Date(query.to) }) } }),
          ...(like && { OR: [{ receiverName: { contains: like, mode: 'insensitive' } }, { receiverDocNumber: { contains: like.replace(/\D/g, '') || like } }] }),
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        take: 300,
      });
      const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))];
      const orders = orderIds.length ? await tx.salesOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } }) : [];
      const orderNumber = new Map(orders.map((o) => [o.id, o.number]));
      return rows.map((r) => ({ ...this.summary(r), orderNumber: r.orderId ? orderNumber.get(r.orderId) ?? null : null }));
    });
  }

  /** Facturas y notas de crédito de un pedido, para la pantalla del pedido. */
  forOrder(orderId: string) {
    return this.uow.read(async (tx) => {
      const rows = await tx.invoice.findMany({ where: { orderId, arcaType: { not: null } }, orderBy: { createdAt: 'asc' } });
      return rows.map((r) => this.summary(r));
    });
  }

  async pdf(id: string) {
    const { invoice, settings, related } = await this.uow.read(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id, arcaType: { not: null } } });
      if (!invoice) throw new NotFoundError('Factura', id);
      const settings = await tx.fiscalSettings.findFirst();
      if (!settings) throw new BusinessRuleError('Faltan los datos fiscales');
      const related = invoice.relatedInvoiceId ? await tx.invoice.findFirst({ where: { id: invoice.relatedInvoiceId } }) : null;
      return { invoice, settings, related };
    });
    const buffer = await renderPdf(
      buildInvoiceDoc({
        type: invoice.type,
        arcaType: invoice.arcaType!,
        pointOfSale: invoice.pointOfSale,
        number: invoice.number,
        issueDate: invoice.issueDate.toISOString().slice(0, 10),
        dueDate: invoice.dueDate.toISOString().slice(0, 10),
        cae: invoice.cae ?? '',
        caeDueDate: invoice.caeDueDate?.toISOString().slice(0, 10) ?? '',
        testing: invoice.testing,
        issuer: {
          legalName: settings.legalName,
          cuit: settings.cuit,
          address: settings.address,
          condition: (invoice.issuerCondition ?? settings.taxCondition) as FiscalSettings['taxCondition'],
          grossIncomeId: settings.grossIncomeId,
          activityStart: settings.activityStart?.toISOString().slice(0, 10) ?? null,
        },
        receiver: {
          name: invoice.receiverName ?? '',
          docType: invoice.receiverDocType ?? 99,
          docNumber: invoice.receiverDocNumber ?? '0',
          condition: (invoice.receiverCondition ?? 'CF') as ReceiverCondition,
          address: invoice.receiverAddress,
        },
        saleCondition: invoice.dueDate.getTime() > invoice.issueDate.getTime() ? 'Cuenta corriente' : 'Contado',
        lines: (invoice.lines as unknown as InvoiceLine[]) ?? [],
        net: Number(invoice.net),
        vat: Number(invoice.vat),
        total: Number(invoice.total),
        related: related ? `${KIND_LABEL[related.type]} ${formatInvoiceNumber(related.pointOfSale, related.number)}` : null,
      }),
    );
    // Solo ASCII: el nombre va en un encabezado HTTP.
    const label = (KIND_LABEL[invoice.type] ?? invoice.type).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '-');
    const name = `${label}-${formatInvoiceNumber(invoice.pointOfSale, invoice.number)}.pdf`;
    return { buffer, filename: name };
  }

  // ---------------------------------------------------------------------------

  /** Un solo comprobante a la vez por empresa: la numeración de ARCA es correlativa. */
  private lock(tx: Tx) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${RequestContextStore.get().tenantId}`}))`;
  }

  private assertAllowed(kind: InvoiceKind, doc: ReceiverDoc) {
    try {
      assertReceiverAllowed(kind, doc);
    } catch (e) {
      throw new BusinessRuleError((e as Error).message);
    }
  }

  /**
   * Pide el CAE del siguiente número. Si ARCA ya tiene autorizado un número que SpiceOS no guardó
   * y coincide con este comprobante (mismo receptor, importe y fecha), lo toma en vez de pedir otro.
   */
  private async authorize(tx: Tx, wsfe: WsfeClient, settings: FiscalSettings, input: Omit<CaeRequestInput, 'number'>) {
    const { kind, pointOfSale } = input;
    const testing = settings.environment === 'TESTING';
    try {
      const last = await wsfe.lastAuthorized(pointOfSale, kind.arcaType);
      const local = await tx.invoice.aggregate({ where: { type: kind.type, pointOfSale, testing }, _max: { number: true } });
      const maxLocal = local._max.number ?? 0;
      if (last > maxLocal) {
        const found = await wsfe.getInvoice(pointOfSale, kind.arcaType, last);
        const same =
          found &&
          found.docType === input.doc.docType &&
          Number(found.docNumber) === Number(input.doc.docNumber) &&
          Math.abs(found.total - input.amounts.total) < 0.005 &&
          found.date === input.date.replace(/-/g, '');
        if (same && last === maxLocal + 1) {
          return { number: last, cae: found.cae, caeDueDate: arcaDate(found.caeDueDate), date: input.date };
        }
        throw new BusinessRuleError(
          `ARCA tiene autorizado el comprobante ${formatInvoiceNumber(pointOfSale, last)} y en SpiceOS el último es el ${formatInvoiceNumber(pointOfSale, maxLocal)}. ` +
            '¿Se facturó con este punto de venta desde otro sistema? Usá un punto de venta exclusivo para SpiceOS.',
        );
      }
      const number = last + 1;
      const result = await wsfe.requestCae(pointOfSale, kind.arcaType, caeDetail({ ...input, number }));
      if (!result.approved) {
        const msgs = [...result.errors, ...result.observations].map((m) => `${m.message} (${m.code})`).join('; ');
        throw new BusinessRuleError(`ARCA rechazó el comprobante: ${msgs || 'sin detalle'}`);
      }
      return { number, cae: result.cae!, caeDueDate: arcaDate(result.caeDueDate!), date: input.date };
    } catch (e) {
      if (e instanceof WsfeError) throw new BusinessRuleError(`ARCA: ${e.message}`);
      if (e instanceof BusinessRuleError) throw e;
      throw new BusinessRuleError(`No se pudo facturar: ${(e as Error).message}. Si se cortó la conexión, volvé a intentar: no se va a duplicar.`);
    }
  }

  private async save(
    tx: Tx,
    scope: UowScope,
    i: {
      settings: FiscalSettings;
      customerId: string;
      paymentTermsDays: number;
      orderId: string | null;
      kind: InvoiceKind;
      number: number;
      date: string;
      cae: string;
      caeDueDate: string;
      doc: ReceiverDoc;
      condition: ReceiverCondition;
      receiverName: string;
      receiverAddress: string | null;
      amounts: Amounts;
      lines: InvoiceLine[];
      relatedInvoiceId?: string;
      reason?: string;
    },
  ): Promise<Invoice> {
    const ctx = RequestContextStore.get();
    const testing = i.settings.environment === 'TESTING';
    const creditNote = i.kind.creditNote;
    const account = await tx.customerAccount.upsert({
      where: { customerId: i.customerId },
      create: { tenantId: ctx.tenantId, customerId: i.customerId },
      update: {},
    });
    const issueDate = new Date(i.date);
    const dueDate = new Date(issueDate.getTime() + (creditNote ? 0 : i.paymentTermsDays) * 86_400_000);
    const invoice = await tx.invoice.create({
      data: {
        tenantId: ctx.tenantId,
        accountId: account.id,
        orderId: i.orderId,
        type: i.kind.type,
        arcaType: i.kind.arcaType,
        pointOfSale: i.settings.pointOfSale!,
        number: i.number,
        issueDate,
        dueDate,
        total: i.amounts.total,
        net: i.amounts.net,
        vat: i.amounts.vat,
        pending: creditNote ? 0 : i.amounts.total,
        status: creditNote ? 'PAID' : 'OPEN',
        cae: i.cae,
        caeDueDate: new Date(i.caeDueDate),
        issuerCondition: i.settings.taxCondition,
        receiverName: i.receiverName,
        receiverDocType: i.doc.docType,
        receiverDocNumber: i.doc.docNumber,
        receiverCondition: i.condition,
        receiverAddress: i.receiverAddress,
        testing,
        lines: i.lines as unknown as Prisma.InputJsonValue,
        relatedInvoiceId: i.relatedInvoiceId,
        createdBy: ctx.onBehalfOf ?? ctx.userId,
      },
    });
    // Cuenta corriente del cliente: la factura suma deuda y la nota de crédito la descuenta. Las de prueba no cuentan.
    if (!testing) {
      const label = `${KIND_LABEL[i.kind.type]} ${formatInvoiceNumber(invoice.pointOfSale, invoice.number)}`;
      await tx.ledgerEntry.create({
        data: {
          tenantId: ctx.tenantId,
          accountId: account.id,
          date: issueDate,
          type: creditNote ? 'CREDIT_NOTE' : 'INVOICE',
          referenceId: invoice.id,
          debit: creditNote ? 0 : i.amounts.total,
          credit: creditNote ? i.amounts.total : 0,
          description: i.reason ? `${label}: ${i.reason}` : label,
        },
      });
      await tx.customerAccount.update({ where: { id: account.id }, data: { balance: { increment: creditNote ? -i.amounts.total : i.amounts.total } } });
    }
    scope.emit(
      new DomainEvent(creditNote ? 'invoice.credit_note_issued' : 'invoice.issued', 'invoice', invoice.id, {
        invoiceId: invoice.id,
        orderId: i.orderId,
        customerId: i.customerId,
        type: i.kind.type,
        number: formatInvoiceNumber(invoice.pointOfSale, invoice.number),
        total: i.amounts.total,
        testing,
      }),
    );
    scope.auditLog({
      action: creditNote ? 'invoice.credit_note' : 'invoice.issue',
      entityType: 'invoice',
      entityId: invoice.id,
      after: { type: i.kind.type, number: invoice.number, pointOfSale: invoice.pointOfSale, total: i.amounts.total, cae: i.cae, orderId: i.orderId, reason: i.reason },
    });
    return invoice;
  }

  private summary(r: Invoice) {
    return {
      id: r.id,
      type: r.type,
      label: KIND_LABEL[r.type] ?? r.type,
      number: formatInvoiceNumber(r.pointOfSale, r.number),
      issueDate: r.issueDate,
      receiverName: r.receiverName,
      receiverDocNumber: r.receiverDocNumber,
      total: Number(r.total),
      status: r.status,
      cae: r.cae,
      caeDueDate: r.caeDueDate,
      testing: r.testing,
      orderId: r.orderId,
      relatedInvoiceId: r.relatedInvoiceId,
    };
  }
}
