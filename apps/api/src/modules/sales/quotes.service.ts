import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  PERMISSIONS,
  type ConvertQuoteInput,
  type CreateQuoteInput,
  type QuoteListQuery,
  type QuoteStatusInput,
  type UpdateQuoteInput,
} from '@spiceos/contracts';
import { UnitOfWork } from '../../shared/unit-of-work';
import { DomainEvent } from '../../shared/domain/domain-event';
import { AggregateRoot } from '../../shared/domain/aggregate-root';
import { NotFoundError, BusinessRuleError, ConflictError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { nextNumber } from '../../shared/sequences';
import { CatalogFacade } from '../catalog/catalog.facade';
import { CrmFacade } from '../crm/crm.facade';
import { addsVat } from '../invoicing/fiscal-settings.service';
import { orderTax, storedTax } from '../orders/order-tax';
import { OrdersService } from '../orders/orders.service';
import { priceLines } from './quote-pricing';
import { displayStatus, isEditable, todayAr, validUntilFrom } from './quote-status';

class QuoteEvents extends AggregateRoot {
  emit(e: DomainEvent) {
    this.record(e);
  }
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly catalog: CatalogFacade,
    private readonly crm: CrmFacade,
    private readonly orders: OrdersService,
  ) {}

  create(input: CreateQuoteInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const { priceListId } = await this.crm.assertCanOrder(tx, input.customerId);
      const catalog = await this.catalog.price(tx, input.lines, priceListId);
      const pricing = priceLines(input.lines, catalog, ctx.maxDiscount);
      const requiresApproval = pricing.approvalReasons.length > 0;
      const tax = orderTax(pricing.total, input.withInvoice, await addsVat(tx));
      const id = randomUUID();
      const number = await nextNumber(tx, input.branchId, 'quote', 'PRE-');

      await tx.quote.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          branchId: input.branchId,
          number,
          customerId: input.customerId,
          opportunityId: input.opportunityId,
          status: requiresApproval ? 'PENDING_APPROVAL' : 'DRAFT',
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          total: pricing.total,
          withInvoice: tax.withInvoice,
          taxTotal: tax.taxTotal,
          validUntil: validUntilFrom(todayAr(), input.validDays),
          notes: input.notes,
          requiresApproval,
          createdByAgent: ctx.actorType === 'AGENT' ? ctx.actor : null,
          createdBy: ctx.actorType === 'USER' ? ctx.userId : ctx.onBehalfOf,
          lines: { create: pricing.lines.map(lineData) },
        },
      });

      const events = new QuoteEvents();
      events.emit(
        new DomainEvent('quote.created', 'quote', id, {
          quoteId: id,
          customerId: input.customerId,
          total: pricing.total,
          currency: 'ARS',
          requiresApproval,
        }),
      );
      if (requiresApproval) {
        events.emit(new DomainEvent('quote.approval_requested', 'quote', id, { quoteId: id, reasons: pricing.approvalReasons }));
      }
      scope.track(events);
      scope.auditLog({ action: 'quote.create', entityType: 'quote', entityId: id, after: { number, ...pricing } });
      return { id, number, status: requiresApproval ? 'PENDING_APPROVAL' : 'DRAFT', ...pricing, ...tax };
    });
  }

  /** Edita un presupuesto que todavía no se aceptó ni rechazó: recalcula precios y vuelve a pedir aprobación si hace falta. */
  update(id: string, input: UpdateQuoteInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const quote = await this.find(tx, id);
      if (!isEditable(quote.status)) throw new BusinessRuleError('Solo se pueden editar presupuestos que no estén aceptados ni rechazados');
      if (quote.version !== input.version) throw new ConflictError('Otra persona modificó el presupuesto; recargalo y volvé a intentar');
      const customerId = input.customerId ?? quote.customerId;
      const { priceListId } = await this.crm.assertCanOrder(tx, customerId);
      const data: Prisma.QuoteUncheckedUpdateInput = {
        customerId,
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.validDays !== undefined && { validUntil: validUntilFrom(todayAr(), input.validDays) }),
      };
      let total = Number(quote.total);
      if (input.lines || customerId !== quote.customerId) {
        const lines =
          input.lines ??
          quote.lines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct) }));
        const pricing = priceLines(lines, await this.catalog.price(tx, lines, priceListId), ctx.maxDiscount);
        await tx.quoteLine.deleteMany({ where: { quoteId: id } });
        await tx.quoteLine.createMany({ data: pricing.lines.map((l) => ({ quoteId: id, ...lineData(l) })) });
        total = pricing.total;
        const requiresApproval = pricing.approvalReasons.length > 0;
        Object.assign(data, {
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          total: pricing.total,
          requiresApproval,
          // Si el cambio necesita aprobación vuelve a pedirla; si ya no la necesita, queda en borrador.
          ...(requiresApproval ? { status: 'PENDING_APPROVAL', approvedBy: null } : quote.status === 'PENDING_APPROVAL' && { status: 'DRAFT' }),
        });
      }
      const tax = orderTax(total, input.withInvoice ?? quote.withInvoice, await addsVat(tx));
      Object.assign(data, { withInvoice: tax.withInvoice, taxTotal: tax.taxTotal });
      await tx.quote.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      scope.auditLog({ action: 'quote.update', entityType: 'quote', entityId: id, before: { total: Number(quote.total) }, after: { total } });
      return { id, version: quote.version + 1 };
    });
  }

  approve(id: string) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const quote = await tx.quote.findFirst({ where: { id } });
      if (!quote) throw new NotFoundError('Presupuesto', id);
      if (quote.status !== 'PENDING_APPROVAL') throw new BusinessRuleError('El presupuesto no está pendiente de aprobación');
      await tx.quote.update({ where: { id }, data: { status: 'DRAFT', approvedBy: ctx.userId, version: { increment: 1 } } });
      const events = new QuoteEvents();
      events.emit(new DomainEvent('quote.approved', 'quote', id, { quoteId: id, approvedBy: ctx.userId }));
      scope.track(events);
      scope.auditLog({ action: 'quote.approve', entityType: 'quote', entityId: id });
      return { id, status: 'DRAFT' };
    });
  }

  /** Enviado al cliente, rechazado por el cliente (con motivo) o de vuelta a borrador. */
  setStatus(id: string, input: QuoteStatusInput) {
    return this.uow.run(async (tx, scope) => {
      const quote = await this.find(tx, id);
      if (!isEditable(quote.status) && !(quote.status === 'REJECTED' && input.status === 'DRAFT')) {
        throw new BusinessRuleError('Este presupuesto ya está cerrado');
      }
      if (quote.status === 'PENDING_APPROVAL' && input.status === 'SENT') throw new BusinessRuleError('Falta que alguien con permiso apruebe los descuentos');
      await tx.quote.update({
        where: { id },
        data: { status: input.status, rejectReason: input.status === 'REJECTED' ? (input.reason ?? null) : null, version: { increment: 1 } },
      });
      scope.auditLog({ action: `quote.${input.status.toLowerCase()}`, entityType: 'quote', entityId: id, after: { reason: input.reason } });
      return { id, status: input.status };
    });
  }

  /**
   * Pasa el presupuesto a pedido en borrador con los mismos precios y descuentos que se presupuestaron
   * (aunque la lista haya cambiado después). El presupuesto queda aceptado y enlazado al pedido.
   */
  async convert(id: string, input: ConvertQuoteInput) {
    const quote = await this.uow.read(async (tx) => {
      const q = await this.find(tx, id);
      const existing = await tx.salesOrder.findFirst({ where: { quoteId: id }, select: { id: true, number: true } });
      const warehouse = input.warehouseId
        ? await tx.warehouse.findFirst({ where: { id: input.warehouseId, branchId: q.branchId, isActive: true } })
        : await tx.warehouse.findFirst({ where: { branchId: q.branchId, isActive: true }, orderBy: { code: 'asc' } });
      return { q, existing, warehouse };
    });
    const { q, existing, warehouse } = quote;
    if (existing) {
      // Ya se había creado el pedido (por ejemplo, se cortó la conexión justo después): solo queda marcarlo aceptado.
      await this.markAccepted(id);
      return { orderId: existing.id, orderNumber: existing.number };
    }
    if (q.status === 'PENDING_APPROVAL') throw new BusinessRuleError('Falta que alguien con permiso apruebe los descuentos');
    if (!isEditable(q.status)) throw new BusinessRuleError('Este presupuesto ya está cerrado');
    if (!warehouse) throw new BusinessRuleError('No hay un depósito activo para armar el pedido');

    const order = await this.orders.create({
      customerId: q.customerId,
      branchId: q.branchId,
      warehouseId: warehouse.id,
      quoteId: id,
      channel: 'sales_rep',
      withInvoice: q.withInvoice,
      requestedDate: input.requestedDate,
      notes: [q.notes, `Presupuesto ${q.number}`].filter(Boolean).join(' · '),
      lines: q.lines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct) })),
    });
    await this.markAccepted(id);
    return { orderId: order.id, orderNumber: order.number };
  }

  private markAccepted(id: string) {
    return this.uow.run(async (tx, scope) => {
      await tx.quote.update({ where: { id }, data: { status: 'ACCEPTED', version: { increment: 1 } } });
      scope.auditLog({ action: 'quote.accept', entityType: 'quote', entityId: id });
    });
  }

  list(query: QuoteListQuery) {
    const like = query.q?.trim();
    const today = todayAr();
    const todayDate = new Date(`${today}T00:00:00Z`);
    return this.uow.read(async (tx) => {
      // "Vencido" no se guarda: es un presupuesto abierto con la validez pasada.
      const statusWhere: Prisma.QuoteWhereInput =
        query.status === 'EXPIRED'
          ? { status: { in: ['DRAFT', 'PENDING_APPROVAL', 'SENT', 'EXPIRED'] }, validUntil: { lt: todayDate } }
          : query.status && isEditable(query.status)
            ? { status: query.status, OR: [{ validUntil: null }, { validUntil: { gte: todayDate } }] }
            : query.status
              ? { status: query.status }
              : {};
      const rows = await tx.quote.findMany({
        where: {
          AND: [
            statusWhere,
            ...(query.customerId ? [{ customerId: query.customerId }] : []),
            ...(like
              ? [{
                  OR: [
                    { number: { contains: like, mode: 'insensitive' as const } },
                    { customer: { legalName: { contains: like, mode: 'insensitive' as const } } },
                    { customer: { tradeName: { contains: like, mode: 'insensitive' as const } } },
                  ],
                }]
              : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { customer: { select: { legalName: true, tradeName: true } }, order: { select: { id: true, number: true } }, _count: { select: { lines: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        status: displayStatus(r.status, r.validUntil, today),
        customerId: r.customerId,
        customer: r.customer.tradeName ?? r.customer.legalName,
        total: Number(r.total),
        ...storedTax(r),
        lines: r._count.lines,
        validUntil: r.validUntil,
        order: r.order,
        createdAt: r.createdAt,
      }));
    });
  }

  get(id: string) {
    const canSeeCost = RequestContextStore.get().permissions.has(PERMISSIONS.catalog.costRead);
    return this.uow.read(async (tx) => {
      const q = await tx.quote.findFirst({
        where: { id },
        include: {
          lines: { orderBy: { variant: { sku: 'asc' } }, include: { variant: { select: { sku: true, name: true, product: { select: { name: true } } } } } },
          customer: { select: { id: true, legalName: true, tradeName: true, taxId: true, phone: true } },
          order: { select: { id: true, number: true, status: true } },
        },
      });
      if (!q) throw new NotFoundError('Presupuesto', id);
      const cost = q.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0);
      return {
        id: q.id,
        number: q.number,
        status: displayStatus(q.status, q.validUntil, todayAr()),
        storedStatus: q.status,
        version: q.version,
        branchId: q.branchId,
        customer: q.customer,
        validUntil: q.validUntil,
        notes: q.notes,
        rejectReason: q.rejectReason,
        requiresApproval: q.requiresApproval,
        subtotal: Number(q.subtotal),
        discountTotal: Number(q.discountTotal),
        total: Number(q.total),
        ...storedTax(q),
        ...(canSeeCost && { marginTotal: Math.round((Number(q.total) - cost) * 100) / 100 }),
        order: q.order,
        createdAt: q.createdAt,
        lines: q.lines.map((l) => ({
          id: l.id,
          variantId: l.variantId,
          sku: l.variant.sku,
          description: `${l.variant.product.name} ${l.variant.name}`,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discountPct: Number(l.discountPct),
          lineTotal: Number(l.lineTotal),
          ...(canSeeCost && { unitCost: Number(l.unitCost) }),
        })),
      };
    });
  }

  private async find(tx: Tx, id: string) {
    const q = await tx.quote.findFirst({ where: { id }, include: { lines: true } });
    if (!q) throw new NotFoundError('Presupuesto', id);
    return q;
  }

  openOpportunities(ownerId?: string) {
    return this.uow.read((tx) =>
      tx.opportunity.findMany({
        where: { closedAt: null, ...(ownerId && { ownerId }) },
        include: { stage: { select: { name: true, probability: true } }, customer: { select: { id: true, legalName: true } } },
        orderBy: [{ expectedClose: 'asc' }],
        take: 100,
      }),
    );
  }

  pipelineSummary() {
    return this.uow.read((tx) =>
      tx.$queryRaw<{ stage: string; position: number; count: number; amount: number; weighted: number }[]>`
        SELECT s.name AS stage, s.position, count(o.id)::int AS count,
               coalesce(sum(o.amount), 0)::float AS amount,
               coalesce(sum(o.amount * s.probability / 100.0), 0)::float AS weighted
        FROM pipeline_stages s
        LEFT JOIN opportunities o ON o.stage_id = s.id AND o.closed_at IS NULL
        GROUP BY s.id ORDER BY s.position`,
    );
  }
}

function lineData(l: { variantId: string; description: string; quantity: number; unitPrice: number; discountPct: number; unitCost: number; lineTotal: number }) {
  return {
    variantId: l.variantId,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountPct: l.discountPct,
    unitCost: l.unitCost,
    lineTotal: l.lineTotal,
  };
}

export type QuoteWithLines = Prisma.QuoteGetPayload<{ include: { lines: true } }>;
