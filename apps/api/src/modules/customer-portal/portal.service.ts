import { Injectable } from '@nestjs/common';
import {
  PORTAL_MIN_ORDER,
  type PortalAccount,
  type PortalCustomerAccess,
  type PortalMe,
  type PortalOrder,
  type PortalOrderCreated,
  type PortalOrderInput,
  type PortalPrices,
} from '@spiceos/contracts';
import { NotFoundError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { InvoicingService } from '../invoicing/invoicing.service';
import { TRACKING_STEP, WebOrdersService } from '../orders/web-orders.service';
import { CollectionsService } from '../receivables/collections.service';
import { PortalAuthService, type PortalCustomer } from './portal-auth.service';

/** Dirección del portal, para compartirla con los clientes. */
export const PORTAL_URL = 'https://www.saboracasa.com.ar/mayoristas';

const invoiceLabel = (i: { type: string; pointOfSale: number; number: number }) =>
  `${i.type.startsWith('NC') ? `Nota de crédito ${i.type.slice(3)}` : `Factura ${i.type}`} ${String(i.pointOfSale).padStart(5, '0')}-${String(i.number).padStart(8, '0')}`;

const overdueText = (o: { amount: number; oldestDueDate: string } | null) =>
  o
    ? `Tenés ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(o.amount)} vencidos. Podés hacer el pedido, pero lo entregamos cuando regularices el pago.`
    : null;

/**
 * Lo que ve y hace un cliente en el portal: sus precios, sus pedidos, su cuenta corriente y sus facturas.
 * Todo se filtra por el cliente de la sesión; nunca se muestran costos, márgenes ni stock.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly uow: UnitOfWork,
    private readonly webOrders: WebOrdersService,
    private readonly collections: CollectionsService,
    private readonly invoicing: InvoicingService,
  ) {}

  /** Corre `fn` dentro de la empresa, con el cliente de la sesión. */
  private async as<T>(org: string, token: string | undefined, fn: (customer: PortalCustomer) => Promise<T>): Promise<T> {
    const ctx = await this.auth.context(org);
    return RequestContextStore.run(ctx, async () => {
      const customer = await this.uow.run((tx) => this.auth.resolve(tx, token));
      return RequestContextStore.run({ ...ctx, actor: `portal:${customer.id}` }, () => fn(customer));
    });
  }

  me(org: string, token: string | undefined): Promise<PortalMe> {
    return this.as(org, token, async (customer) => {
      const [c, statement] = await Promise.all([
        this.uow.read((tx) =>
          tx.customer.findFirstOrThrow({
            where: { id: customer.id },
            select: {
              code: true,
              legalName: true,
              tradeName: true,
              phone: true,
              email: true,
              deliveryDays: true,
              deliveryHours: true,
              priceList: { select: { name: true } },
              addresses: { orderBy: [{ isDefault: 'desc' }], take: 1, select: { street: true, city: true } },
            },
          }),
        ),
        this.collections.statement(customer.id),
      ]);
      const overdue = statement.overdue > 0.005 ? { amount: statement.overdue, oldestDueDate: statement.oldestDueDate ?? '' } : null;
      const a = c.addresses[0];
      return {
        customer: {
          code: c.code,
          name: c.tradeName ?? c.legalName,
          phone: c.phone,
          email: c.email,
          address: a ? [a.street, a.city].filter(Boolean).join(', ') : null,
          deliveryDays: c.deliveryDays,
          deliveryHours: c.deliveryHours,
        },
        priceList: c.priceList?.name ?? 'Mayorista',
        minOrder: PORTAL_MIN_ORDER,
        account: {
          balance: statement.balance,
          overdue: statement.overdue,
          dueSoon: statement.dueSoon,
          oldestDueDate: statement.oldestDueDate,
          termsDays: statement.termsDays,
        },
        overdueWarning: overdueText(overdue),
      };
    });
  }

  /** Precio de cada SKU para este cliente: su lista primero y, lo que no esté ahí, la Mayorista. */
  prices(org: string, token: string | undefined): Promise<PortalPrices> {
    return this.as(org, token, (customer) =>
      this.uow.read(async (tx) => {
        const lists = await this.priceLists(tx, customer);
        const rows = await tx.priceListItem.findMany({
          where: { priceListId: { in: lists }, minQuantity: 1, variant: { isActive: true, product: { isActive: true, deletedAt: null } } },
          select: { price: true, priceListId: true, updatedAt: true, variant: { select: { sku: true } } },
        });
        const bySku = new Map<string, { price: number; rank: number }>();
        let updatedAt: Date | null = null;
        for (const r of rows) {
          const rank = lists.indexOf(r.priceListId);
          const prev = bySku.get(r.variant.sku);
          if (Number(r.price) > 0 && (!prev || rank < prev.rank)) bySku.set(r.variant.sku, { price: Number(r.price), rank });
          if (!updatedAt || r.updatedAt > updatedAt) updatedAt = r.updatedAt;
        }
        return {
          items: [...bySku].map(([sku, p]) => ({ sku, price: p.price })).sort((a, b) => a.sku.localeCompare(b.sku)),
          updatedAt: updatedAt?.toISOString() ?? null,
        };
      }),
    );
  }

  orders(org: string, token: string | undefined): Promise<PortalOrder[]> {
    return this.as(org, token, (customer) =>
      this.uow.read(async (tx) => {
        const rows = await tx.salesOrder.findMany({
          where: { customerId: customer.id },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            number: true,
            status: true,
            createdAt: true,
            total: true,
            withInvoice: true,
            lines: {
              orderBy: { variant: { sku: 'asc' } },
              select: { quantity: true, unitPrice: true, lineTotal: true, variant: { select: { sku: true, name: true, product: { select: { name: true } } } } },
            },
            statusHistory: { where: { to: { in: ['DELIVERED', 'INVOICED'] } }, orderBy: { changedAt: 'asc' }, take: 1, select: { changedAt: true } },
          },
        });
        const invoices = rows.length
          ? await tx.invoice.findMany({
              where: { orderId: { in: rows.map((r) => r.id) }, arcaType: { not: null }, status: { not: 'CANCELLED' } },
              orderBy: { createdAt: 'asc' },
              select: { id: true, orderId: true, type: true, pointOfSale: true, number: true, issueDate: true, total: true },
            })
          : [];
        return rows.map((o) => {
          const step = TRACKING_STEP[o.status];
          return {
            id: o.id,
            number: o.number,
            step: step.step,
            label: step.label,
            detail: step.detail,
            createdAt: o.createdAt.toISOString(),
            deliveredAt: o.statusHistory[0]?.changedAt.toISOString() ?? null,
            total: Number(o.total),
            withInvoice: o.withInvoice,
            lines: o.lines.map((l) => ({
              sku: l.variant.sku,
              description: `${l.variant.product.name} ${l.variant.name}`.trim(),
              quantity: Number(l.quantity),
              unitPrice: Number(l.unitPrice),
              lineTotal: Number(l.lineTotal),
            })),
            invoices: invoices
              .filter((i) => i.orderId === o.id)
              .map((i) => ({ id: i.id, label: invoiceLabel(i), date: i.issueDate.toISOString().slice(0, 10), total: Number(i.total) })),
          };
        });
      }),
    );
  }

  createOrder(org: string, token: string | undefined, input: PortalOrderInput): Promise<PortalOrderCreated> {
    return this.as(org, token, async (customer) => {
      const priceListId = customer.priceListId ?? (await this.uow.read((tx) => this.mayoristaId(tx)));
      const order = await this.webOrders.receiveFromPortal({ ...customer, priceListId }, input);
      const overdue = await this.uow.read((tx) => this.collections.overdueDebt(tx, customer.id));
      return { number: order.number, total: order.total, overdueWarning: overdueText(overdue) };
    });
  }

  account(org: string, token: string | undefined): Promise<PortalAccount> {
    return this.as(org, token, async (customer) => {
      const s = await this.collections.statement(customer.id);
      const orderIds = s.charges.map((c) => c.order?.id).filter((x): x is string => !!x);
      const invoices = orderIds.length
        ? await this.uow.read((tx) =>
            tx.invoice.findMany({
              where: { orderId: { in: orderIds }, arcaType: { not: null }, status: { not: 'CANCELLED' }, NOT: { type: { startsWith: 'NC' } } },
              select: { id: true, orderId: true },
            }),
          )
        : [];
      const invoiceByOrder = new Map(invoices.map((i) => [i.orderId!, i.id]));
      return {
        balance: s.balance,
        overdue: s.overdue,
        dueSoon: s.dueSoon,
        credit: s.credit,
        termsDays: s.termsDays,
        charges: s.charges
          .filter((c) => c.status !== 'CANCELLED')
          .map((c) => ({
            date: c.date,
            dueDate: c.dueDate,
            description: c.order ? `Pedido ${c.order.number}${c.order.invoice ? ` · ${c.order.invoice}` : ''}` : (c.description ?? 'Saldo'),
            total: c.total,
            paid: c.paid,
            balance: c.balance,
            status: c.status,
            daysOverdue: c.daysOverdue,
            invoiceId: c.order ? (invoiceByOrder.get(c.order.id) ?? null) : null,
          })),
        payments: s.payments
          .filter((p) => !p.cancelled)
          .map((p) => ({ date: p.date, method: p.method, amount: p.amount, reference: p.reference })),
      };
    });
  }

  /** PDF de una factura, solo si es de este cliente. */
  invoicePdf(org: string, token: string | undefined, invoiceId: string) {
    return this.as(org, token, async (customer) => {
      const mine = await this.uow.read((tx) =>
        tx.invoice.findFirst({ where: { id: invoiceId, arcaType: { not: null }, account: { customerId: customer.id } }, select: { id: true } }),
      );
      if (!mine) throw new NotFoundError('Factura', invoiceId);
      return this.invoicing.pdf(invoiceId);
    });
  }

  /** Para la ficha del cliente en SpiceOS: sesiones abiertas del portal. */
  access(customerId: string): Promise<PortalCustomerAccess> {
    return this.uow.read(async (tx) => {
      const sessions = await tx.portalSession.findMany({
        where: { customerId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: 'desc' },
        select: { id: true, phone: true, createdAt: true, lastSeenAt: true },
      });
      return {
        sessions: sessions.map((s) => ({ id: s.id, phone: s.phone, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString() })),
        portalUrl: PORTAL_URL,
      };
    });
  }

  /** Cierra todas las sesiones del portal de un cliente (perdió el celular, dejó de ser cliente). */
  revoke(customerId: string) {
    return this.uow.run(async (tx, scope) => {
      const { count } = await tx.portalSession.updateMany({ where: { customerId, revokedAt: null }, data: { revokedAt: new Date() } });
      scope.auditLog({ action: 'portal.revoke', entityType: 'customer', entityId: customerId, after: { sessions: count } });
      return { closed: count };
    });
  }

  private async priceLists(tx: Tx, customer: PortalCustomer): Promise<string[]> {
    const mayorista = await this.mayoristaId(tx);
    return [...new Set([customer.priceListId, mayorista].filter((x): x is string => !!x))];
  }

  private async mayoristaId(tx: Tx): Promise<string | null> {
    const l =
      (await tx.priceList.findFirst({ where: { name: { equals: 'Mayorista', mode: 'insensitive' } }, select: { id: true } })) ??
      (await tx.priceList.findFirst({ where: { isDefault: true }, select: { id: true } }));
    return l?.id ?? null;
  }
}
