import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { OrderStatus } from '@prisma/client';
import {
  PERMISSIONS,
  type CreateOrderInput,
  type OrderListQuery,
  type OrderPreviewInput,
  type OrderTransitionInput,
  type UpdateOrderInput,
} from '@spiceos/contracts';
import { UnitOfWork, UowScope } from '../../shared/unit-of-work';
import { AggregateRoot } from '../../shared/domain/aggregate-root';
import { DomainEvent } from '../../shared/domain/domain-event';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { nextNumber } from '../../shared/sequences';
import { CatalogFacade } from '../catalog/catalog.facade';
import { CrmFacade } from '../crm/crm.facade';
import { InventoryFacade } from '../inventory/inventory.facade';
import { InventoryService } from '../inventory/inventory.service';
import { priceLines } from '../sales/quote-pricing';
import { orderTax } from './order-tax';

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
  READY: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED'],
  DELIVERED: ['INVOICED'],
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'borrador',
  CONFIRMED: 'confirmado',
  PICKING: 'en preparación',
  READY: 'listo para despachar',
  DISPATCHED: 'despachado',
  DELIVERED: 'entregado',
  INVOICED: 'facturado',
  CANCELLED: 'cancelado',
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly crm: CrmFacade,
    private readonly catalog: CatalogFacade,
    private readonly inventory: InventoryFacade,
    private readonly stock: InventoryService,
  ) {}

  /** Precios, margen y disponible por línea, sin guardar nada. Lo usa la pantalla de armado. */
  preview(input: OrderPreviewInput) {
    const canSeeCost = RequestContextStore.get().permissions.has(PERMISSIONS.catalog.costRead);
    return this.uow.read(async (tx) => {
      const { priceListId } = await this.crm.assertCanOrder(tx, input.customerId);
      const priced = await this.catalog.price(tx, input.lines, priceListId);
      const available = await this.inventory.available(tx, input.warehouseId, input.lines.map((l) => l.variantId));
      const missing = input.lines.filter((l) => l.unitPrice === undefined && priced.get(l.variantId)?.listPrice == null);
      const pricing = priceLines(
        input.lines.filter((l) => !missing.includes(l)),
        priced,
        RequestContextStore.get().maxDiscount,
      );
      const byVariant = new Map(pricing.lines.map((l) => [l.variantId, l]));
      return {
        lines: input.lines.map((l) => {
          const v = priced.get(l.variantId)!;
          const p = byVariant.get(l.variantId);
          return {
            variantId: l.variantId,
            sku: v.sku,
            description: v.name,
            quantity: l.quantity,
            listPrice: v.listPrice,
            unitPrice: p?.unitPrice ?? null,
            discountPct: l.discountPct,
            lineTotal: p?.lineTotal ?? null,
            available: available.get(l.variantId) ?? 0,
            ...(canSeeCost && { marginPct: p?.marginPct ?? null }),
          };
        }),
        subtotal: pricing.subtotal,
        discountTotal: pricing.discountTotal,
        total: pricing.total,
        ...orderTax(pricing.total, input.withInvoice),
        ...(canSeeCost && { marginTotal: pricing.marginTotal }),
        warnings: [
          ...missing.map((l) => `${priced.get(l.variantId)!.name} no tiene precio en la lista del cliente; indicá un precio`),
          ...pricing.approvalReasons,
        ],
      };
    });
  }

  create(input: CreateOrderInput) {
    const ctx = RequestContextStore.get();
    this.assertBranch(input.branchId);
    return this.uow.run(async (tx, scope) => {
      const { priceListId } = await this.crm.assertCanOrder(tx, input.customerId);
      await this.assertWarehouse(tx, input.warehouseId, input.branchId);
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
          ...this.tax(pricing.total, input.withInvoice),
          marginTotal: pricing.marginTotal,
          requestedDate: input.requestedDate ? new Date(input.requestedDate) : null,
          notes: input.notes,
          sellerId: ctx.onBehalfOf ?? ctx.userId,
          createdBy: ctx.onBehalfOf ?? ctx.userId,
          lines: { create: pricing.lines.map((l) => this.lineData(l)) },
          statusHistory: { create: { to: 'DRAFT', changedBy: ctx.actor } },
        },
      });
      const events = new OrderEvents();
      events.emit(new DomainEvent('order.created', 'order', id, { orderId: id, customerId: input.customerId, total: pricing.total }));
      scope.track(events);
      scope.auditLog({ action: 'order.create', entityType: 'order', entityId: id, after: { number, total: pricing.total } });
      return { id, number, total: pricing.total, ...orderTax(pricing.total, input.withInvoice) };
    });
  }

  /** Edita un borrador: reemplaza líneas y recalcula precios con la lista vigente del cliente. */
  update(id: string, input: UpdateOrderInput) {
    return this.uow.run(async (tx, scope) => {
      const order = await this.findOrder(tx, id);
      if (order.status !== 'DRAFT') throw new BusinessRuleError('Solo se pueden editar pedidos en borrador');
      if (order.version !== input.version) throw new ConflictError('Otra persona modificó el pedido; recargalo y volvé a intentar');
      if (input.warehouseId) await this.assertWarehouse(tx, input.warehouseId, order.branchId);
      const data: Record<string, unknown> = {
        ...(input.warehouseId && { warehouseId: input.warehouseId }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.withInvoice !== undefined && { withInvoice: input.withInvoice }),
        ...(input.requestedDate !== undefined && { requestedDate: input.requestedDate ? new Date(input.requestedDate) : null }),
      };
      if (input.lines) {
        const { priceListId } = await this.crm.assertCanOrder(tx, order.customerId);
        const pricing = priceLines(input.lines, await this.catalog.price(tx, input.lines, priceListId), 100);
        await tx.salesOrderLine.deleteMany({ where: { orderId: id } });
        await tx.salesOrderLine.createMany({ data: pricing.lines.map((l) => ({ orderId: id, ...this.lineData(l) })) });
        Object.assign(data, {
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          total: pricing.total,
          marginTotal: pricing.marginTotal,
        });
      }
      // El IVA se recalcula si cambian las líneas o si pasa a ser con o sin factura.
      Object.assign(data, this.tax(Number(data.total ?? order.total), input.withInvoice ?? order.withInvoice));
      await tx.salesOrder.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      scope.auditLog({ action: 'order.update', entityType: 'order', entityId: id, before: { total: Number(order.total) }, after: data });
      return { id, version: order.version + 1 };
    });
  }

  /** Confirma: valida cliente, reserva stock por FEFO (guardando qué lote) y emite order.confirmed. */
  confirm(id: string) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const order = await this.findOrder(tx, id);
      this.assertTransition(order.status, 'CONFIRMED');
      await this.crm.assertCanOrder(tx, order.customerId);
      for (const line of order.lines) {
        const label = `${line.variant.product.name} ${line.variant.name} (${line.variant.sku})`;
        const allocations = await this.inventory.reserve(tx, order.warehouseId, line.variantId, Number(line.quantity), label);
        await tx.orderAllocation.createMany({
          data: allocations.map((a) => ({ tenantId: ctx.tenantId, orderLineId: line.id, stockItemId: a.stockItemId, lotId: a.lotId, quantity: a.quantity })),
        });
      }
      await this.setStatus(tx, order, 'CONFIRMED', { confirmedAt: new Date() });
      this.emit(scope, 'order.confirmed', order, { confirmedAt: new Date().toISOString() });
      scope.auditLog({ action: 'order.confirm', entityType: 'order', entityId: id });
      await this.stock.checkBelowMinimum(tx, scope, order.lines.map((l) => l.variantId));
      return { id, status: 'CONFIRMED' };
    });
  }

  /** Preparación, despacho (descuenta stock de los lotes reservados), entrega y cancelación. */
  transition(id: string, input: OrderTransitionInput) {
    return this.uow.run(async (tx, scope) => {
      const order = await this.findOrder(tx, id);
      this.assertTransition(order.status, input.to);
      const allocations = order.lines.flatMap((l) =>
        l.allocations.map((a) => ({ stockItemId: a.stockItemId, lotId: a.lotId, quantity: Number(a.quantity), variantId: l.variantId, unitCost: Number(l.unitCost) })),
      );
      if (input.to === 'CANCELLED') {
        if (!RequestContextStore.get().permissions.has(PERMISSIONS.orders.confirm)) throw new BusinessRuleError('No tenés permiso para cancelar pedidos');
        if (!input.reason?.trim()) throw new BusinessRuleError('Indicá el motivo de la cancelación');
        await this.inventory.release(tx, allocations);
        await tx.orderAllocation.deleteMany({ where: { orderLineId: { in: order.lines.map((l) => l.id) } } });
        this.emit(scope, 'order.cancelled', order, { reason: input.reason });
      }
      if (input.to === 'DISPATCHED') {
        await this.inventory.consume(tx, allocations, { type: 'sales_order', id });
        this.emit(scope, 'order.dispatched', order, {});
      }
      if (input.to === 'DELIVERED') {
        for (const l of order.lines) await tx.salesOrderLine.update({ where: { id: l.id }, data: { deliveredQty: l.quantity } });
        this.emit(scope, 'order.delivered', order, {});
      }
      await this.setStatus(tx, order, input.to, {}, input.reason);
      scope.auditLog({ action: `order.${input.to.toLowerCase()}`, entityType: 'order', entityId: id, before: { status: order.status }, after: { status: input.to, reason: input.reason } });
      return { id, status: input.to };
    });
  }

  list(query: OrderListQuery) {
    const like = query.q?.trim();
    return this.uow.read(async (tx) => {
      const rows = await tx.salesOrder.findMany({
        where: {
          ...(query.status && { status: query.status }),
          ...(query.customerId && { customerId: query.customerId }),
          ...(like && {
            OR: [
              { number: { contains: like, mode: 'insensitive' } },
              { customer: { legalName: { contains: like, mode: 'insensitive' } } },
              { customer: { tradeName: { contains: like, mode: 'insensitive' } } },
            ],
          }),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { customer: { select: { legalName: true, tradeName: true } }, _count: { select: { lines: true } } },
      });
      return rows.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        customerId: o.customerId,
        customer: o.customer.tradeName ?? o.customer.legalName,
        channel: o.channel,
        total: Number(o.total),
        ...orderTax(Number(o.total), o.withInvoice),
        lines: o._count.lines,
        requestedDate: o.requestedDate,
        createdAt: o.createdAt,
      }));
    });
  }

  get(id: string) {
    const canSeeCost = RequestContextStore.get().permissions.has(PERMISSIONS.catalog.costRead);
    return this.uow.read(async (tx) => {
      const o = await tx.salesOrder.findFirst({
        where: { id },
        include: {
          customer: { select: { id: true, legalName: true, tradeName: true, taxId: true, phone: true } },
          warehouse: { select: { id: true, name: true } },
          statusHistory: { orderBy: { changedAt: 'asc' } },
          lines: {
            orderBy: { variant: { sku: 'asc' } },
            include: {
              variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
              allocations: { include: { lot: { select: { code: true, expiresAt: true } } } },
            },
          },
        },
      });
      if (!o) throw new NotFoundError('Pedido', id);
      const available = o.status === 'DRAFT' ? await this.inventory.available(tx, o.warehouseId, o.lines.map((l) => l.variantId)) : null;
      return {
        id: o.id,
        number: o.number,
        status: o.status,
        statusLabel: STATUS_LABEL[o.status],
        nextStatuses: TRANSITIONS[o.status] ?? [],
        version: o.version,
        channel: o.channel,
        branchId: o.branchId,
        customer: o.customer,
        warehouse: o.warehouse,
        requestedDate: o.requestedDate,
        notes: o.notes,
        subtotal: Number(o.subtotal),
        discountTotal: Number(o.discountTotal),
        total: Number(o.total),
        ...orderTax(Number(o.total), o.withInvoice),
        ...(canSeeCost && { marginTotal: Number(o.marginTotal) }),
        createdAt: o.createdAt,
        confirmedAt: o.confirmedAt,
        lines: o.lines.map((l) => ({
          id: l.id,
          variantId: l.variantId,
          sku: l.variant.sku,
          description: `${l.variant.product.name} ${l.variant.name}`,
          quantity: Number(l.quantity),
          deliveredQty: Number(l.deliveredQty),
          unitPrice: Number(l.unitPrice),
          discountPct: Number(l.discountPct),
          lineTotal: Number(l.lineTotal),
          ...(canSeeCost && { unitCost: Number(l.unitCost) }),
          ...(available && { available: available.get(l.variantId) ?? 0 }),
          lots: l.allocations.map((a) => ({ lot: a.lot?.code ?? null, expiresAt: a.lot?.expiresAt ?? null, quantity: Number(a.quantity) })),
        })),
        history: o.statusHistory.map((h) => ({ from: h.from, to: h.to, at: h.changedAt, by: h.changedBy, reason: h.reason })),
      };
    });
  }

  private tax(net: number, withInvoice: boolean) {
    const { taxTotal } = orderTax(net, withInvoice);
    return { withInvoice, taxTotal };
  }

  private lineData(l: { variantId: string; quantity: number; unitPrice: number; discountPct: number; unitCost: number; lineTotal: number }) {
    return {
      variantId: l.variantId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      unitCost: l.unitCost,
      lineTotal: l.lineTotal,
    };
  }

  private async findOrder(tx: Tx, id: string) {
    // Bloquea el pedido: dos confirmaciones simultáneas no pueden reservar dos veces.
    await tx.$queryRaw`SELECT id FROM sales_orders WHERE id = ${id}::uuid FOR UPDATE`;
    const order = await tx.salesOrder.findFirst({
      where: { id },
      include: { lines: { include: { allocations: true, variant: { select: { sku: true, name: true, product: { select: { name: true } } } } } } },
    });
    if (!order) throw new NotFoundError('Pedido', id);
    this.assertBranch(order.branchId);
    return order;
  }

  private async setStatus(tx: Tx, order: { id: string; status: OrderStatus }, to: OrderStatus, extra: Record<string, unknown>, reason?: string) {
    await tx.salesOrder.update({
      where: { id: order.id },
      data: {
        ...extra,
        status: to,
        version: { increment: 1 },
        statusHistory: { create: { from: order.status, to, changedBy: RequestContextStore.get().actor, reason } },
      },
    });
  }

  private emit(scope: UowScope, type: 'order.confirmed' | 'order.dispatched' | 'order.delivered' | 'order.cancelled', order: { id: string; customerId: string; total: unknown; number: string }, extra: Record<string, unknown>) {
    const events = new OrderEvents();
    events.emit(new DomainEvent(type, 'order', order.id, { orderId: order.id, number: order.number, customerId: order.customerId, total: Number(order.total), ...extra }));
    scope.track(events);
  }

  private assertTransition(from: string, to: string) {
    if (!TRANSITIONS[from]?.includes(to)) {
      throw new BusinessRuleError(`Un pedido ${STATUS_LABEL[from] ?? from} no puede pasar a ${STATUS_LABEL[to] ?? to}`);
    }
  }

  private async assertWarehouse(tx: Tx, warehouseId: string, branchId: string) {
    const w = await tx.warehouse.findFirst({ where: { id: warehouseId, isActive: true }, select: { branchId: true } });
    if (!w) throw new NotFoundError('Depósito', warehouseId);
    if (w.branchId !== branchId) throw new BusinessRuleError('El depósito no pertenece a la sucursal del pedido');
  }

  private assertBranch(branchId: string) {
    const { branchScope } = RequestContextStore.get();
    if (branchScope.length && !branchScope.includes(branchId)) {
      throw new BusinessRuleError('No tenés acceso a esa sucursal');
    }
  }
}
