import { Injectable } from '@nestjs/common';
import { Prisma, type OrderStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { CreateRouteInput, FailedStopInput, UpdateRouteInput } from '@spiceos/contracts';
import { BusinessRuleError, NotFoundError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { storedTax } from '../orders/order-tax';
import { OrdersService } from '../orders/orders.service';
import { mapsUrl, notReadyToLeave, routeDone, zoneOf } from './route-plan';

/** Pedidos que se pueden poner en una hoja de ruta: aprobados y todavía no entregados. */
const PLANNABLE: OrderStatus[] = ['CONFIRMED', 'PICKING', 'READY', 'DISPATCHED'];
/** Una entrega "viva" (programada o en camino) ya tiene hoja; las fallidas vuelven a la lista. */
const LIVE = ['SCHEDULED', 'IN_TRANSIT'] as const;

const orderInclude = {
  customer: {
    select: {
      id: true,
      legalName: true,
      tradeName: true,
      phone: true,
      deliveryDays: true,
      deliveryHours: true,
      addresses: { orderBy: { isDefault: 'desc' as const }, take: 1 },
    },
  },
} satisfies Prisma.SalesOrderInclude;

type OrderWithCustomer = Prisma.SalesOrderGetPayload<{ include: typeof orderInclude }>;

/**
 * Logística: hojas de ruta del reparto propio. Se arma la hoja con pedidos listos, se sale a repartir
 * (los pedidos pasan a despachados y se descuenta el stock) y en cada parada se marca entregado o no.
 */
@Injectable()
export class LogisticsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly orders: OrdersService,
  ) {}

  /** Pedidos para repartir que no están en una hoja activa, con dirección, zona y horario del cliente. */
  pending() {
    return this.uow.read(async (tx) => {
      const rows = await tx.salesOrder.findMany({
        where: { status: { in: PLANNABLE }, deliveries: { none: { status: { in: [...LIVE] } } } },
        orderBy: [{ requestedDate: 'asc' }, { createdAt: 'asc' }],
        take: 300,
        include: { ...orderInclude, deliveries: { where: { status: 'FAILED' }, orderBy: { id: 'desc' }, take: 1, select: { notes: true } } },
      });
      const addresses = await this.deliveryAddresses(tx, rows);
      return rows.map((o) => ({ ...this.orderSummary(o, addresses), lastFailure: o.deliveries[0]?.notes ?? null }));
    });
  }

  listRoutes() {
    return this.uow.read(async (tx) => {
      const routes = await tx.route.findMany({
        orderBy: [{ date: 'desc' }],
        take: 60,
        include: { stops: { select: { delivery: { select: { status: true } } } } },
      });
      return routes.map((r) => ({
        id: r.id,
        date: r.date,
        driverName: r.driverName,
        status: r.status,
        stops: r.stops.length,
        delivered: r.stops.filter((s) => s.delivery.status === 'DELIVERED').length,
        failed: r.stops.filter((s) => s.delivery.status === 'FAILED').length,
      }));
    });
  }

  getRoute(id: string) {
    return this.uow.read(async (tx) => {
      const r = await tx.route.findFirst({
        where: { id },
        include: { stops: { orderBy: { position: 'asc' }, include: { delivery: { include: { order: { include: orderInclude } } } } } },
      });
      if (!r) throw new NotFoundError('Hoja de ruta', id);
      const addresses = await this.deliveryAddresses(tx, r.stops.map((s) => s.delivery.order));
      return {
        id: r.id,
        date: r.date,
        driverName: r.driverName,
        status: r.status,
        stops: r.stops.map((s) => ({
          deliveryId: s.deliveryId,
          position: s.position,
          status: s.delivery.status,
          deliveredAt: s.delivery.deliveredAt,
          notes: s.delivery.notes,
          order: this.orderSummary(s.delivery.order, addresses),
        })),
      };
    });
  }

  createRoute(input: CreateRouteInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const orders = await this.assertPlannable(tx, input.orderIds);
      const id = randomUUID();
      await tx.route.create({
        data: { id, tenantId: ctx.tenantId, branchId: orders[0]!.branchId, date: new Date(input.date), driverName: input.driverName?.trim() || null },
      });
      await this.addStops(tx, id, input.orderIds, 0);
      scope.auditLog({ action: 'route.create', entityType: 'route', entityId: id, after: { date: input.date, orders: input.orderIds.length } });
      return { id };
    });
  }

  /** Solo antes de salir: fecha, repartidor y pedidos (la lista nueva reemplaza a la anterior, en ese orden). */
  updateRoute(id: string, input: UpdateRouteInput) {
    return this.uow.run(async (tx, scope) => {
      const route = await this.findRoute(tx, id);
      if (route.status !== 'PLANNED') throw new BusinessRuleError('La hoja ya salió: solo se pueden marcar las entregas');
      await tx.route.update({
        where: { id },
        data: {
          ...(input.date && { date: new Date(input.date) }),
          ...(input.driverName !== undefined && { driverName: input.driverName.trim() || null }),
        },
      });
      if (input.orderIds) {
        const current = route.stops.map((s) => s.delivery.orderId);
        const added = input.orderIds.filter((o) => !current.includes(o));
        if (added.length) await this.assertPlannable(tx, added);
        // Se rehacen las paradas: las entregas de los pedidos que salen de la hoja se borran.
        await tx.routeStop.deleteMany({ where: { routeId: id } });
        await tx.delivery.deleteMany({ where: { id: { in: route.stops.map((s) => s.deliveryId) } } });
        await this.addStops(tx, id, input.orderIds, 0);
      }
      scope.auditLog({ action: 'route.update', entityType: 'route', entityId: id, after: input });
      return { id };
    });
  }

  deleteRoute(id: string) {
    return this.uow.run(async (tx, scope) => {
      const route = await this.findRoute(tx, id);
      if (route.status !== 'PLANNED') throw new BusinessRuleError('La hoja ya salió y no se puede borrar');
      await tx.routeStop.deleteMany({ where: { routeId: id } });
      await tx.delivery.deleteMany({ where: { id: { in: route.stops.map((s) => s.deliveryId) } } });
      await tx.route.delete({ where: { id } });
      scope.auditLog({ action: 'route.delete', entityType: 'route', entityId: id });
      return { id };
    });
  }

  /**
   * Salir a repartir: cada pedido listo pasa a despachado (descuenta el stock de sus lotes) y sus
   * entregas quedan en camino. Si se corta a mitad, volver a apretar sigue con los que faltan.
   */
  async start(id: string) {
    const route = await this.uow.read((tx) => this.findRoute(tx, id));
    if (route.status === 'DONE') throw new BusinessRuleError('Esta hoja ya terminó');
    const notReady = notReadyToLeave(route.stops.map((s) => s.delivery.order));
    if (notReady.length) throw new BusinessRuleError(`Faltan preparar estos pedidos: ${notReady.join(', ')}. Marcalos como listos o sacalos de la hoja.`);
    for (const s of route.stops) {
      if (s.delivery.order.status === 'READY') await this.orders.transition(s.delivery.orderId, { to: 'DISPATCHED', reason: 'Salió en la hoja de ruta' });
    }
    await this.uow.run(async (tx, scope) => {
      await tx.delivery.updateMany({ where: { id: { in: route.stops.map((s) => s.deliveryId) }, status: 'SCHEDULED' }, data: { status: 'IN_TRANSIT' } });
      await tx.route.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      scope.auditLog({ action: 'route.start', entityType: 'route', entityId: id });
    });
    return { id, status: 'IN_PROGRESS' };
  }

  async delivered(deliveryId: string) {
    const d = await this.uow.read((tx) => this.findStop(tx, deliveryId));
    if (d.status === 'DELIVERED') return { deliveryId, status: 'DELIVERED' };
    if (d.status !== 'IN_TRANSIT' && d.status !== 'FAILED') throw new BusinessRuleError('Primero hay que salir a repartir con esta hoja');
    if (d.order.status === 'DISPATCHED') await this.orders.transition(d.orderId, { to: 'DELIVERED', reason: 'Entregado en la hoja de ruta' });
    await this.uow.run(async (tx, scope) => {
      await tx.delivery.update({ where: { id: deliveryId }, data: { status: 'DELIVERED', deliveredAt: new Date(), notes: null } });
      await this.closeIfDone(tx, d.stop!.routeId);
      scope.auditLog({ action: 'delivery.delivered', entityType: 'delivery', entityId: deliveryId });
    });
    return { deliveryId, status: 'DELIVERED' };
  }

  /** No se pudo entregar: el pedido sigue despachado y vuelve a "Para repartir" para otra hoja. */
  failed(deliveryId: string, input: FailedStopInput) {
    return this.uow.run(async (tx, scope) => {
      const d = await this.findStop(tx, deliveryId);
      if (d.status !== 'IN_TRANSIT') throw new BusinessRuleError(d.status === 'DELIVERED' ? 'Ya figura entregado' : 'Primero hay que salir a repartir con esta hoja');
      await tx.delivery.update({ where: { id: deliveryId }, data: { status: 'FAILED', notes: input.reason } });
      await this.closeIfDone(tx, d.stop!.routeId);
      scope.auditLog({ action: 'delivery.failed', entityType: 'delivery', entityId: deliveryId, after: { reason: input.reason } });
      return { deliveryId, status: 'FAILED' };
    });
  }

  private async closeIfDone(tx: Tx, routeId: string) {
    const stops = await tx.routeStop.findMany({ where: { routeId }, select: { delivery: { select: { status: true } } } });
    if (routeDone(stops.map((s) => s.delivery))) await tx.route.update({ where: { id: routeId }, data: { status: 'DONE' } });
  }

  private async addStops(tx: Tx, routeId: string, orderIds: string[], offset: number) {
    const { tenantId } = RequestContextStore.get();
    for (const [i, orderId] of orderIds.entries()) {
      const deliveryId = randomUUID();
      await tx.delivery.create({ data: { id: deliveryId, tenantId, orderId, status: 'SCHEDULED' } });
      await tx.routeStop.create({ data: { routeId, deliveryId, position: offset + i + 1 } });
    }
  }

  private async assertPlannable(tx: Tx, orderIds: string[]) {
    if (new Set(orderIds).size !== orderIds.length) throw new BusinessRuleError('Hay pedidos repetidos en la hoja');
    const orders = await tx.salesOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, number: true, status: true, branchId: true, deliveries: { where: { status: { in: [...LIVE] } }, select: { id: true } } },
    });
    if (orders.length !== orderIds.length) throw new BusinessRuleError('Algún pedido no existe');
    const bad = orders.filter((o) => !PLANNABLE.includes(o.status));
    if (bad.length) throw new BusinessRuleError(`Estos pedidos no se pueden repartir: ${bad.map((o) => o.number).join(', ')}`);
    const busy = orders.filter((o) => o.deliveries.length);
    if (busy.length) throw new BusinessRuleError(`Estos pedidos ya están en otra hoja: ${busy.map((o) => o.number).join(', ')}`);
    return orders;
  }

  private async findRoute(tx: Tx, id: string) {
    const r = await tx.route.findFirst({
      where: { id },
      include: { stops: { orderBy: { position: 'asc' }, include: { delivery: { include: { order: { select: { id: true, number: true, status: true } } } } } } },
    });
    if (!r) throw new NotFoundError('Hoja de ruta', id);
    return r;
  }

  private async findStop(tx: Tx, deliveryId: string) {
    const d = await tx.delivery.findFirst({ where: { id: deliveryId }, include: { stop: true, order: { select: { status: true } } } });
    if (!d || !d.stop) throw new NotFoundError('Entrega', deliveryId);
    return d;
  }

  /** Dirección de entrega elegida en el pedido; si no tiene, la principal del cliente. */
  private async deliveryAddresses(tx: Tx, orders: { deliveryAddressId: string | null }[]) {
    const ids = orders.map((o) => o.deliveryAddressId).filter((x): x is string => !!x);
    const rows = ids.length ? await tx.customerAddress.findMany({ where: { id: { in: ids } } }) : [];
    return new Map(rows.map((a) => [a.id, a]));
  }

  private orderSummary(o: OrderWithCustomer, addresses: Map<string, OrderWithCustomer['customer']['addresses'][number]>) {
    const a = (o.deliveryAddressId && addresses.get(o.deliveryAddressId)) || o.customer.addresses[0] || null;
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      requestedDate: o.requestedDate,
      notes: o.notes,
      ...storedTax(o),
      customer: {
        id: o.customer.id,
        name: o.customer.tradeName ?? o.customer.legalName,
        phone: o.customer.phone ?? o.contactPhone,
        deliveryDays: o.customer.deliveryDays,
        deliveryHours: o.customer.deliveryHours,
      },
      address: a ? { street: a.street, city: a.city, province: a.province, note: a.deliveryNote } : null,
      zone: zoneOf(a?.city),
      mapsUrl: mapsUrl(a),
    };
  }
}
