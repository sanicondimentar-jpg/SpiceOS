import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PurchaseOrderStatus } from '@prisma/client';
import type { PurchaseOrderListQuery, PurchaseOrderTransitionInput, UpdatePurchaseOrderInput } from '@spiceos/contracts';
import { UnitOfWork, UowScope } from '../../shared/unit-of-work';
import { DomainEvent } from '../../shared/domain/domain-event';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/domain/errors';
import { round2 } from '../../shared/domain/money';
import type { Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { nextNumber } from '../../shared/sequences';
import { InventoryFacade } from '../inventory/inventory.facade';
import { packSkuOf, packsFor, unitsPerPack } from './shortage';

export interface ShortageLine {
  orderLineId: string;
  variantId: string;
  missing: number;
}

/** Qué se hizo con el faltante de una línea del pedido. */
export interface ShortageResult {
  sku: string;
  description: string;
  missing: number;
  /** Cajas en depósito que alcanza con abrir (sueltos). */
  openPacks?: { sku: string; packs: number };
  /** Lo que se agregó a la nota de pedido del proveedor. */
  purchase?: { purchaseOrderId: string; number: string; supplier: string; sku: string; quantity: number };
  /** Sin proveedor asignado: hay que comprarlo a mano. */
  noSupplier?: boolean;
}

const TRANSITIONS: Record<string, PurchaseOrderStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['RECEIVED', 'CANCELLED'],
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'borrador',
  SENT: 'enviada',
  PARTIALLY_RECEIVED: 'recibida en parte',
  RECEIVED: 'recibida',
  CANCELLED: 'cancelada',
};

/** Notas de pedido a proveedores. Se arman solas con los faltantes de los pedidos confirmados. */
@Injectable()
export class PurchasingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly inventory: InventoryFacade,
  ) {}

  /**
   * Suma los faltantes a la nota en borrador del proveedor preferido de cada presentación
   * (una por proveedor y sucursal; si no hay, la crea). Corre dentro de la confirmación del pedido.
   */
  async addShortages(tx: Tx, scope: UowScope, ctx: { branchId: string; warehouseId: string; orderNumber: string }, lines: ShortageLine[]): Promise<ShortageResult[]> {
    const results: ShortageResult[] = [];
    for (const line of lines) {
      const variant = await tx.productVariant.findFirstOrThrow({
        where: { id: line.variantId },
        select: { id: true, sku: true, name: true, currentCost: true, product: { select: { name: true } } },
      });
      const result: ShortageResult = { sku: variant.sku, description: `${variant.product.name} ${variant.name}`, missing: line.missing };
      results.push(result);

      let buyVariant = variant;
      let buyQty = line.missing;
      const packSku = packSkuOf(variant.sku);
      const pack = packSku
        ? await tx.productVariant.findFirst({
            where: { sku: packSku, isActive: true },
            select: { id: true, sku: true, name: true, currentCost: true, product: { select: { name: true } } },
          })
        : null;
      const perPack = pack ? unitsPerPack(pack.name) : null;
      if (pack && perPack) {
        const packsAvailable = (await this.inventory.available(tx, ctx.warehouseId, [pack.id])).get(pack.id) ?? 0;
        const { open, buy } = packsFor(line.missing, perPack, packsAvailable);
        if (open) result.openPacks = { sku: pack.sku, packs: open };
        if (!buy) continue;
        buyVariant = pack;
        buyQty = buy;
      }

      const source = await tx.supplierProduct.findFirst({
        where: { variantId: buyVariant.id, supplier: { isActive: true } },
        orderBy: { isPreferred: 'desc' },
        include: { supplier: { select: { id: true, legalName: true } } },
      });
      if (!source) {
        result.noSupplier = true;
        continue;
      }
      const po = await this.openDraft(tx, scope, source.supplier.id, ctx.branchId);
      const unitCost = Number(source.lastCost ?? buyVariant.currentCost);
      const existing = await tx.purchaseOrderLine.findFirst({ where: { purchaseOrderId: po.id, variantId: buyVariant.id } });
      const poLine = existing
        ? await tx.purchaseOrderLine.update({ where: { id: existing.id }, data: { quantity: { increment: buyQty } } })
        : await tx.purchaseOrderLine.create({ data: { purchaseOrderId: po.id, variantId: buyVariant.id, quantity: buyQty, unitCost } });
      await tx.salesOrderLine.update({ where: { id: line.orderLineId }, data: { purchaseOrderLineId: poLine.id } });
      await this.recalculate(tx, po.id);
      scope.auditLog({
        action: 'purchase_order.add_shortage',
        entityType: 'purchase_order',
        entityId: po.id,
        after: { sku: buyVariant.sku, quantity: buyQty, salesOrder: ctx.orderNumber },
      });
      result.purchase = { purchaseOrderId: po.id, number: po.number, supplier: source.supplier.legalName, sku: buyVariant.sku, quantity: buyQty };
    }
    return results;
  }

  list(query: PurchaseOrderListQuery) {
    return this.uow.read(async (tx) => {
      const rows = await tx.purchaseOrder.findMany({
        where: { ...(query.status && { status: query.status }), ...(query.supplierId && { supplierId: query.supplierId }) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { supplier: { select: { legalName: true } }, _count: { select: { lines: true } } },
      });
      return rows.map((p) => ({
        id: p.id,
        number: p.number,
        status: p.status,
        supplierId: p.supplierId,
        supplier: p.supplier.legalName,
        total: Number(p.total),
        lines: p._count.lines,
        createdAt: p.createdAt,
        sentAt: p.sentAt,
        expectedDate: p.expectedDate,
      }));
    });
  }

  get(id: string) {
    return this.uow.read(async (tx) => {
      const p = await tx.purchaseOrder.findFirst({
        where: { id },
        include: {
          supplier: { select: { id: true, legalName: true, phone: true, email: true, taxId: true } },
          lines: {
            orderBy: { variant: { sku: 'asc' } },
            include: {
              variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
              orderLines: { select: { quantity: true, backorderQty: true, variant: { select: { sku: true } }, order: { select: { id: true, number: true, status: true } } } },
            },
          },
        },
      });
      if (!p) throw new NotFoundError('Nota de pedido', id);
      return {
        id: p.id,
        number: p.number,
        status: p.status,
        statusLabel: STATUS_LABEL[p.status],
        nextStatuses: TRANSITIONS[p.status] ?? [],
        version: p.version,
        supplier: p.supplier,
        notes: p.notes,
        total: Number(p.total),
        expectedDate: p.expectedDate,
        createdAt: p.createdAt,
        sentAt: p.sentAt,
        lines: p.lines.map((l) => ({
          id: l.id,
          variantId: l.variantId,
          sku: l.variant.sku,
          description: `${l.variant.product.name} ${l.variant.name}`,
          quantity: Number(l.quantity),
          receivedQty: Number(l.receivedQty),
          unitCost: Number(l.unitCost),
          lineTotal: round2(Number(l.quantity) * Number(l.unitCost)),
          orders: l.orderLines.map((o) => ({ id: o.order.id, number: o.order.number, status: o.order.status, sku: o.variant.sku, missing: Number(o.backorderQty) })),
        })),
      };
    });
  }

  /** Edita una nota en borrador: cantidades, costos y notas. Cantidad 0 quita la línea. */
  update(id: string, input: UpdatePurchaseOrderInput) {
    return this.uow.run(async (tx, scope) => {
      const po = await this.lock(tx, id);
      if (po.status !== 'DRAFT') throw new BusinessRuleError('Solo se pueden editar notas de pedido en borrador');
      if (po.version !== input.version) throw new ConflictError('Otra persona modificó la nota; recargala y volvé a intentar');
      for (const l of input.lines ?? []) {
        const existing = await tx.purchaseOrderLine.findFirst({ where: { purchaseOrderId: id, variantId: l.variantId } });
        if (l.quantity === 0) {
          if (existing) await tx.purchaseOrderLine.delete({ where: { id: existing.id } });
          continue;
        }
        if (existing) {
          await tx.purchaseOrderLine.update({ where: { id: existing.id }, data: { quantity: l.quantity, ...(l.unitCost !== undefined && { unitCost: l.unitCost }) } });
        } else {
          const v = await tx.productVariant.findFirst({ where: { id: l.variantId, isActive: true }, select: { currentCost: true } });
          if (!v) throw new NotFoundError('Presentación', l.variantId);
          await tx.purchaseOrderLine.create({ data: { purchaseOrderId: id, variantId: l.variantId, quantity: l.quantity, unitCost: l.unitCost ?? Number(v.currentCost) } });
        }
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(input.notes !== undefined && { notes: input.notes || null }),
          ...(input.expectedDate !== undefined && { expectedDate: input.expectedDate ? new Date(input.expectedDate) : null }),
          version: { increment: 1 },
        },
      });
      await this.recalculate(tx, id);
      scope.auditLog({ action: 'purchase_order.update', entityType: 'purchase_order', entityId: id, after: input });
      return { id, version: po.version + 1 };
    });
  }

  /** Enviada al proveedor, recibida o cancelada. El ingreso al stock se carga en Inventario. */
  transition(id: string, input: PurchaseOrderTransitionInput) {
    return this.uow.run(async (tx, scope) => {
      const po = await this.lock(tx, id);
      if (!TRANSITIONS[po.status]?.includes(input.to)) {
        throw new BusinessRuleError(`Una nota ${STATUS_LABEL[po.status]} no puede pasar a ${STATUS_LABEL[input.to]}`);
      }
      if (input.to === 'SENT' && !(await tx.purchaseOrderLine.count({ where: { purchaseOrderId: id } }))) {
        throw new BusinessRuleError('La nota de pedido no tiene productos');
      }
      if (input.to === 'CANCELLED' && !input.reason?.trim()) throw new BusinessRuleError('Indicá el motivo de la cancelación');
      if (input.to === 'RECEIVED') {
        const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });
        for (const l of lines) await tx.purchaseOrderLine.update({ where: { id: l.id }, data: { receivedQty: l.quantity } });
        scope.emit(new DomainEvent('purchase_order.received', 'purchase_order', id, { purchaseOrderId: id, number: po.number }));
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: input.to,
          version: { increment: 1 },
          ...(input.to === 'SENT' && { sentAt: new Date() }),
          ...(input.to === 'CANCELLED' && { notes: [po.notes, `Cancelada: ${input.reason!.trim()}`].filter(Boolean).join('\n') }),
        },
      });
      scope.auditLog({ action: `purchase_order.${input.to.toLowerCase()}`, entityType: 'purchase_order', entityId: id, before: { status: po.status }, after: { status: input.to, reason: input.reason } });
      return { id, status: input.to };
    });
  }

  private async openDraft(tx: Tx, scope: UowScope, supplierId: string, branchId: string) {
    const [found] = await tx.$queryRaw<{ id: string; number: string }[]>`
      SELECT id, number FROM purchase_orders
      WHERE supplier_id = ${supplierId}::uuid AND branch_id = ${branchId}::uuid AND status = 'DRAFT'
      ORDER BY created_at LIMIT 1 FOR UPDATE`;
    if (found) return found;
    const ctx = RequestContextStore.get();
    const id = randomUUID();
    const number = await nextNumber(tx, branchId, 'purchase_order', 'NP-');
    await tx.purchaseOrder.create({
      data: { id, tenantId: ctx.tenantId, branchId, supplierId, number, createdBy: ctx.actorType === 'USER' ? ctx.userId : (ctx.onBehalfOf ?? null) },
    });
    scope.emit(new DomainEvent('purchase_order.created', 'purchase_order', id, { purchaseOrderId: id, number, supplierId }));
    scope.auditLog({ action: 'purchase_order.create', entityType: 'purchase_order', entityId: id, after: { number, supplierId } });
    return { id, number };
  }

  private async recalculate(tx: Tx, id: string) {
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id }, select: { quantity: true, unitCost: true } });
    const total = round2(lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitCost), 0));
    await tx.purchaseOrder.update({ where: { id }, data: { total } });
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
    const po = await tx.purchaseOrder.findFirst({ where: { id } });
    if (!po) throw new NotFoundError('Nota de pedido', id);
    const { branchScope } = RequestContextStore.get();
    if (branchScope.length && !branchScope.includes(po.branchId)) throw new BusinessRuleError('No tenés acceso a esa sucursal');
    return po;
  }
}
