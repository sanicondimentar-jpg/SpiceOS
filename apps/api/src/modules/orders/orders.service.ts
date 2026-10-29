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
import { PurchasingService, type ShortageLine, type ShortageResult } from '../purchasing/purchasing.service';
import { priceLines } from '../sales/quote-pricing';
import { orderTax } from './order-tax';

class OrderEvents extends AggregateRoot {
  emit(e: DomainEvent) {
    this.record(e);
  }
}

/** Transiciones válidas de un pedido. */
const TRANSITIONS: Record<string, string[]> = {
  PENDING_REVIEW: ['CONFIRMED', 'CANCELLED'],
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PICKING', 'CANCELLED'],
  PICKING: ['READY', 'CANCELLED'],
  READY: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED'],
  DELIVERED: ['INVOICED'],
};

/** Estados en los que el pedido todavía se puede editar. */
const EDITABLE: string[] = ['PENDING_REVIEW', 'DRAFT'];

const STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: 'pendiente de revisión',
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
    private readonly purchasing: PurchasingService,
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

  /**
   * Edita un borrador o un pedido web pendiente: reemplaza líneas y recalcula precios con la
   * lista vigente del cliente. En un pedido web también se puede cambiar el cliente (por ejemplo,
   * si ya existía con otro teléfono).
   */
  update(id: string, input: UpdateOrderInput) {
    return this.uow.run(async (tx, scope) => {
      const order = await this.findOrder(tx, id);
      if (!EDITABLE.includes(order.status)) throw new BusinessRuleError('Solo se pueden editar pedidos en borrador o pendientes de revisión');
      if (order.version !== input.version) throw new ConflictError('Otra persona modificó el pedido; recargalo y volvé a intentar');
      if (input.warehouseId) await this.assertWarehouse(tx, input.warehouseId, order.branchId);
      const customerId = input.customerId ?? order.customerId;
      const data: Record<string, unknown> = {
        ...(input.warehouseId && { warehouseId: input.warehouseId }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.withInvoice !== undefined && { withInvoice: input.withInvoice }),
        ...(input.requestedDate !== undefined && { requestedDate: input.requestedDate ? new Date(input.requestedDate) : null }),
      };
      if (customerId !== order.customerId) {
        if (order.status !== 'PENDING_REVIEW') throw new BusinessRuleError('Solo se puede cambiar el cliente de un pedido web pendiente');
        await this.crm.assertCanOrder(tx, customerId);
        if (order.createdCustomer) await this.crm.discardWebProspect(tx, scope, order.customerId, id);
        Object.assign(data, { customerId, createdCustomer: false });
      }
      if (input.lines) {
        const { priceListId } = await this.crm.assertCanOrder(tx, customerId);
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

  /**
   * Confirma (o aprueba un pedido web): valida cliente y reserva por FEFO lo que haya en stock
   * (guardando qué lote). Lo que falta queda pendiente en la línea y se suma a la nota de pedido
   * del proveedor; se reserva al empezar la preparación.
   */
  confirm(id: string) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const order = await this.findOrder(tx, id);
      this.assertTransition(order.status, 'CONFIRMED');
      await this.crm.assertCanOrder(tx, order.customerId);
      const short: ShortageLine[] = [];
      // Primero cajas y granel: los sueltos que falten se cubren abriendo las cajas que sobren.
      const lines = [...order.lines].sort((a, b) => Number(a.variant.sku.endsWith('-U')) - Number(b.variant.sku.endsWith('-U')));
      for (const line of lines) {
        const { allocations, missing } = await this.inventory.reserveUpTo(tx, order.warehouseId, line.variantId, Number(line.quantity));
        await tx.orderAllocation.createMany({
          data: allocations.map((a) => ({ tenantId: ctx.tenantId, orderLineId: line.id, stockItemId: a.stockItemId, lotId: a.lotId, quantity: a.quantity })),
        });
        if (missing > 0) {
          await tx.salesOrderLine.update({ where: { id: line.id }, data: { backorderQty: missing } });
          short.push({ orderLineId: line.id, variantId: line.variantId, missing });
        }
      }
      const shortages: ShortageResult[] = short.length
        ? await this.purchasing.addShortages(tx, scope, { branchId: order.branchId, warehouseId: order.warehouseId, orderNumber: order.number }, short)
        : [];
      await this.setStatus(tx, order, 'CONFIRMED', { confirmedAt: new Date() }, order.status === 'PENDING_REVIEW' ? 'Pedido web aprobado' : undefined);
      this.emit(scope, 'order.confirmed', order, { confirmedAt: new Date().toISOString(), backorder: short.length > 0 });
      scope.auditLog({ action: 'order.confirm', entityType: 'order', entityId: id, after: { shortages } });
      await this.stock.checkBelowMinimum(tx, scope, order.lines.map((l) => l.variantId));
      return { id, status: 'CONFIRMED', shortages };
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
        // Un pedido web descartado (duplicado, mal hecho) no deja un cliente fantasma.
        if (order.status === 'PENDING_REVIEW' && order.createdCustomer) await this.crm.discardWebProspect(tx, scope, order.customerId, id);
        this.emit(scope, 'order.cancelled', order, { reason: input.reason });
      }
      if (input.to === 'PICKING') await this.reserveBackorders(tx, order);
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
              purchaseOrderLine: { select: { purchaseOrder: { select: { id: true, number: true, status: true } } } },
            },
          },
        },
      });
      if (!o) throw new NotFoundError('Pedido', id);
      const available = EDITABLE.includes(o.status) ? await this.inventory.available(tx, o.warehouseId, o.lines.map((l) => l.variantId)) : null;
      // Para detectar pedidos web repetidos: otros pedidos del mismo cliente en los últimos días.
      const duplicates =
        o.status === 'PENDING_REVIEW'
          ? await tx.salesOrder.findMany({
              where: { customerId: o.customerId, id: { not: o.id }, status: { not: 'CANCELLED' }, createdAt: { gte: new Date(o.createdAt.getTime() - 7 * 86_400_000) } },
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: { id: true, number: true, status: true, total: true, createdAt: true },
            })
          : [];
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
        contactName: o.contactName,
        contactPhone: o.contactPhone,
        webTotal: o.webTotal === null ? null : Number(o.webTotal),
        createdCustomer: o.createdCustomer,
        possibleDuplicates: duplicates.map((d) => ({ ...d, total: Number(d.total) })),
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
          backorderQty: Number(l.backorderQty),
          purchaseOrder: l.purchaseOrderLine?.purchaseOrder ?? null,
          lots: l.allocations.map((a) => ({ lot: a.lot?.code ?? null, expiresAt: a.lot?.expiresAt ?? null, quantity: Number(a.quantity) })),
        })),
        history: o.statusHistory.map((h) => ({ from: h.from, to: h.to, at: h.changedAt, by: h.changedBy, reason: h.reason })),
      };
    });
  }

  /** Reserva lo que faltó al confirmar; si todavía no entró la mercadería, no se puede preparar. */
  private async reserveBackorders(tx: Tx, order: Awaited<ReturnType<OrdersService['findOrder']>>) {
    const ctx = RequestContextStore.get();
    for (const line of order.lines.filter((l) => Number(l.backorderQty) > 0)) {
      const label = `${line.variant.product.name} ${line.variant.name} (${line.variant.sku})`;
      const allocations = await this.inventory.reserve(tx, order.warehouseId, line.variantId, Number(line.backorderQty), label).catch((e: Error) => {
        throw new BusinessRuleError(`Todavía falta mercadería para preparar el pedido. ${e.message}`);
      });
      await tx.orderAllocation.createMany({
        data: allocations.map((a) => ({ tenantId: ctx.tenantId, orderLineId: line.id, stockItemId: a.stockItemId, lotId: a.lotId, quantity: a.quantity })),
      });
      await tx.salesOrderLine.update({ where: { id: line.id }, data: { backorderQty: 0 } });
    }
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
