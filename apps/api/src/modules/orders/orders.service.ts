import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreateOrderInput } from '@spiceos/contracts';
import { UnitOfWork } from '../../shared/unit-of-work';
import { AggregateRoot } from '../../shared/domain/aggregate-root';
import { DomainEvent } from '../../shared/domain/domain-event';
import { BusinessRuleError, NotFoundError } from '../../shared/domain/errors';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { nextNumber } from '../../shared/sequences';
import { CatalogFacade } from '../catalog/catalog.facade';
import { CrmFacade } from '../crm/crm.facade';
import { InventoryFacade } from '../inventory/inventory.facade';
import { priceLines } from '../sales/quote-pricing';

class OrderEvents extends AggregateRoot {
  emit(e: DomainEvent) {
    this.record(e);
  }
}

/** Transiciones válidas de un pedido. */
const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PICKING', 'CANCELLED'],
  PICKING: ['READY', 'CANCELLED'],
  READY: ['DISPATCHED'],
  DISPATCHED: ['DELIVERED'],
  DELIVERED: ['INVOICED'],
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly crm: CrmFacade,
    private readonly catalog: CatalogFacade,
    private readonly inventory: InventoryFacade,
  ) {}

  create(input: CreateOrderInput) {
    const ctx = RequestContextStore.get();
    this.assertBranch(input.branchId);
    return this.uow.run(async (tx, scope) => {
      const { priceListId } = await this.crm.assertCanOrder(tx, input.customerId);
      const pricing = priceLines(input.lines, await this.catalog.price(tx, input.lines, priceListId), 100);
      const id = randomUUID();
      const number = await nextNumber(tx, input.branchId, 'order', 'PED-');
      await tx.salesOrder.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          branchId: input.branchId,
          warehouseId: input.warehouseId,
          number,
          customerId: input.customerId,
          quoteId: input.quoteId,
          channel: input.channel,
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          total: pricing.total,
          marginTotal: pricing.marginTotal,
          requestedDate: input.requestedDate ? new Date(input.requestedDate) : null,
          notes: input.notes,
          sellerId: ctx.onBehalfOf ?? ctx.userId,
          createdBy: ctx.onBehalfOf ?? ctx.userId,
          lines: {
            create: pricing.lines.map((l) => ({
              variantId: l.variantId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct,
              unitCost: l.unitCost,
              lineTotal: l.lineTotal,
            })),
          },
          statusHistory: { create: { to: 'DRAFT', changedBy: ctx.actor } },
        },
      });
      const events = new OrderEvents();
      events.emit(new DomainEvent('order.created', 'order', id, { orderId: id, customerId: input.customerId, total: pricing.total }));
      scope.track(events);
      scope.auditLog({ action: 'order.create', entityType: 'order', entityId: id, after: { number, total: pricing.total } });
      return { id, number, total: pricing.total };
    });
  }

  /** Confirma: valida cliente, reserva stock por FEFO y emite order.confirmed. */
  confirm(id: string) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const order = await tx.salesOrder.findFirst({ where: { id }, include: { lines: true } });
      if (!order) throw new NotFoundError('Pedido', id);
      this.assertTransition(order.status, 'CONFIRMED');
      await this.crm.assertCanOrder(tx, order.customerId);
      for (const line of order.lines) {
        await this.inventory.reserve(tx, order.warehouseId, line.variantId, Number(line.quantity));
      }
      await tx.salesOrder.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          version: { increment: 1 },
          statusHistory: { create: { from: order.status, to: 'CONFIRMED', changedBy: ctx.actor } },
        },
      });
      const events = new OrderEvents();
      events.emit(
        new DomainEvent('order.confirmed', 'order', id, {
          orderId: id,
          customerId: order.customerId,
          total: Number(order.total),
          confirmedAt: new Date().toISOString(),
        }),
      );
      scope.track(events);
      scope.auditLog({ action: 'order.confirm', entityType: 'order', entityId: id });
      return { id, status: 'CONFIRMED' };
    });
  }

  list(status?: string, customerId?: string) {
    return this.uow.read((tx) =>
      tx.salesOrder.findMany({
        where: { ...(status && { status: status as never }), ...(customerId && { customerId }) },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { customer: { select: { legalName: true } } },
      }),
    );
  }

  private assertTransition(from: string, to: string) {
    if (!TRANSITIONS[from]?.includes(to)) throw new BusinessRuleError(`No se puede pasar un pedido de ${from} a ${to}`);
  }

  private assertBranch(branchId: string) {
    const { branchScope } = RequestContextStore.get();
    if (branchScope.length && !branchScope.includes(branchId)) {
      throw new BusinessRuleError('No tenés acceso a esa sucursal');
    }
  }
}
