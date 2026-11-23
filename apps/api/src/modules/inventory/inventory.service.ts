import { Injectable } from '@nestjs/common';
import type { AdjustStockInput, BreakPackInput, MovementsQuery, ReceiveStockInput, StockQuery } from '@spiceos/contracts';
import { PERMISSIONS } from '@spiceos/contracts';
import { DomainEvent } from '../../shared/domain/domain-event';
import { BusinessRuleError, NotFoundError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import { round2 } from '../../shared/domain/money';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork, UowScope } from '../../shared/unit-of-work';
import { ProductsService } from '../catalog/application/products.service';
import { allocateFefo } from './fefo';
import { pickPacks } from './pack-sources';
import { lotCodeFor } from './lot-code';
import { InventoryFacade } from './inventory.facade';

@Injectable()
export class InventoryService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ledger: InventoryFacade,
    private readonly products: ProductsService,
  ) {}

  warehouses() {
    return this.uow.read((tx) => tx.warehouse.findMany({ where: { isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, branchId: true } }));
  }

  /** Saldo por presentación: existente, reservado, disponible, próximo vencimiento y punto de reposición. */
  stock(query: StockQuery) {
    const canSeeCost = RequestContextStore.get().permissions.has(PERMISSIONS.catalog.costRead);
    const like = query.q ? `%${query.q}%` : null;
    return this.uow.read(async (tx) => {
      const rows = await tx.$queryRaw<
        { variant_id: string; sku: string; product: string; presentation: string; on_hand: number; reserved: number; next_expiry: Date | null; reorder_point: number; min_stock: number; cost: number }[]
      >`
        SELECT v.id AS variant_id, v.sku, p.name AS product, v.name AS presentation,
               coalesce(sum(s.on_hand), 0)::float AS on_hand, coalesce(sum(s.reserved), 0)::float AS reserved,
               min(l.expires_at) FILTER (WHERE s.on_hand > 0) AS next_expiry,
               v.reorder_point::float AS reorder_point, v.min_stock::float AS min_stock, v.current_cost::float AS cost
        FROM product_variants v
        JOIN products p ON p.id = v.product_id AND p.deleted_at IS NULL
        LEFT JOIN stock_items s ON s.variant_id = v.id
          AND (${query.warehouseId ?? null}::uuid IS NULL OR s.warehouse_id = ${query.warehouseId ?? null}::uuid)
        LEFT JOIN lots l ON l.id = s.lot_id
        WHERE v.is_active
          -- Los combos no tienen stock propio (descuentan el de sus sobres).
          AND NOT EXISTS (SELECT 1 FROM kit_components k WHERE k.kit_variant_id = v.id)
          AND (${like}::text IS NULL OR v.sku ILIKE ${like} OR p.name ILIKE ${like} OR v.name ILIKE ${like})
        GROUP BY v.id, p.name
        ORDER BY p.name, v.sku`;
      return rows
        .map((r) => {
          const available = r.on_hand - r.reserved;
          return {
            variantId: r.variant_id,
            sku: r.sku,
            name: `${r.product} ${r.presentation}`,
            onHand: r.on_hand,
            reserved: r.reserved,
            available,
            nextExpiry: r.next_expiry,
            reorderPoint: r.reorder_point,
            low: available <= r.reorder_point && (r.reorder_point > 0 || available <= 0),
            ...(canSeeCost && { value: Math.round(r.on_hand * r.cost * 100) / 100 }),
          };
        })
        .filter((r) => !query.onlyLow || r.low);
    });
  }

  /** Detalle de una presentación por depósito y lote. */
  variantStock(variantId: string) {
    return this.uow.read(async (tx) => {
      const variant = await tx.productVariant.findFirst({ where: { id: variantId }, select: { id: true, sku: true, name: true, product: { select: { name: true } } } });
      if (!variant) throw new NotFoundError('Presentación', variantId);
      const items = await tx.stockItem.findMany({
        where: { variantId, OR: [{ onHand: { gt: 0 } }, { reserved: { gt: 0 } }] },
        include: { warehouse: { select: { code: true, name: true } }, lot: { select: { code: true, expiresAt: true, qualityStatus: true } } },
        orderBy: [{ lot: { expiresAt: 'asc' } }],
      });
      return {
        variantId,
        sku: variant.sku,
        name: `${variant.product.name} ${variant.name}`,
        lots: items.map((i) => ({
          stockItemId: i.id,
          warehouseId: i.warehouseId,
          warehouse: i.warehouse.name,
          lotId: i.lotId,
          lot: i.lot?.code ?? null,
          expiresAt: i.lot?.expiresAt ?? null,
          qualityStatus: i.lot?.qualityStatus ?? null,
          onHand: Number(i.onHand),
          reserved: Number(i.reserved),
        })),
      };
    });
  }

  /**
   * Ingreso de mercadería: crea lotes, suma stock y opcionalmente actualiza el costo vigente.
   * Con proveedor, además queda la compra en su cuenta (lo que se le debe) para registrarle el pago.
   */
  receive(input: ReceiveStockInput, reason = 'Ingreso de mercadería', opts: { pendingReceiptId?: string } = {}) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      await this.assertWarehouse(tx, input.warehouseId);
      if (input.supplierId && !(await tx.supplier.findFirst({ where: { id: input.supplierId }, select: { id: true } }))) {
        throw new NotFoundError('Proveedor', input.supplierId);
      }
      let total = 0;
      const variants = await this.variantsById(tx, input.lines.map((l) => l.variantId));
      const received: { sku: string; quantity: number; lot: string | null }[] = [];
      for (const line of input.lines) {
        const v = variants.get(line.variantId)!;
        const expiresAt = line.expiresAt ? new Date(line.expiresAt) : null;
        const lotCode = lotCodeFor(line.lotCode, expiresAt);
        const lot = lotCode ? await this.ledger.lot(tx, line.variantId, lotCode, expiresAt) : null;
        await this.ledger.post(tx, {
          warehouseId: input.warehouseId,
          variantId: line.variantId,
          lotId: lot?.id ?? null,
          type: 'PURCHASE_RECEIPT',
          quantity: line.quantity,
          unitCost: line.unitCost ?? v.cost,
          referenceType: input.supplierId ? 'supplier' : undefined,
          referenceId: input.supplierId,
          reason: [reason, input.reference].filter(Boolean).join(' · '),
        });
        if (input.updateCost && line.unitCost !== undefined && line.unitCost !== v.cost) {
          await this.products.applyCost(tx, scope, line.variantId, line.unitCost, 'purchase');
          v.cost = line.unitCost;
        }
        total += line.quantity * (line.unitCost ?? v.cost);
        received.push({ sku: v.sku, quantity: line.quantity, lot: lot?.code ?? null });
      }
      let purchaseId: string | undefined;
      total = round2(total);
      if (input.supplierId && total > 0) {
        const purchase = await tx.supplierPurchase.create({
          data: {
            tenantId: ctx.tenantId,
            supplierId: input.supplierId,
            date: input.documentDate ? new Date(`${input.documentDate}T00:00:00Z`) : new Date(new Date().toISOString().slice(0, 10)),
            reference: input.reference ?? null,
            total,
            source: 'RECEIPT',
            pendingReceiptId: opts.pendingReceiptId ?? null,
            createdBy: ctx.userId,
          },
          select: { id: true },
        });
        purchaseId = purchase.id;
      }
      scope.auditLog({ action: 'stock.receive', entityType: 'warehouse', entityId: input.warehouseId, after: { reference: input.reference, supplierId: input.supplierId, purchaseId, total, lines: received } });
      return { received: received.length, purchaseId, total };
    });
  }

  adjust(input: AdjustStockInput) {
    return this.uow.run(async (tx, scope) => {
      await this.assertWarehouse(tx, input.warehouseId);
      const v = (await this.variantsById(tx, [input.variantId])).get(input.variantId)!;
      let delta = input.quantity;
      if (input.mode === 'count') {
        const item = await tx.stockItem.findFirst({ where: { warehouseId: input.warehouseId, variantId: input.variantId, lotId: input.lotId ?? null } });
        delta = input.quantity - Number(item?.onHand ?? 0);
        if (delta === 0) return { delta: 0, onHand: input.quantity };
      }
      if (input.type === 'WASTE' && delta > 0) throw new BusinessRuleError('Una merma tiene que restar stock');
      const result = await this.ledger.post(tx, {
        warehouseId: input.warehouseId,
        variantId: input.variantId,
        lotId: input.lotId ?? null,
        type: input.type,
        quantity: delta,
        unitCost: v.cost,
        referenceType: 'adjustment',
        reason: input.mode === 'count' ? `Conteo: ${input.reason}` : input.reason,
      });
      scope.auditLog({ action: 'stock.adjust', entityType: 'variant', entityId: input.variantId, after: { warehouseId: input.warehouseId, lotId: input.lotId, delta, reason: input.reason } });
      await this.checkBelowMinimum(tx, scope, [input.variantId]);
      return { delta, onHand: result.onHand };
    });
  }

  /** Abre cajas por FEFO: cada lote de caja que sale entra como el mismo lote de la presentación suelta. */
  breakPack(input: BreakPackInput) {
    return this.uow.run(async (tx, scope) => {
      await this.assertWarehouse(tx, input.warehouseId);
      const variants = await this.variantsById(tx, [input.fromVariantId, input.toVariantId]);
      const from = variants.get(input.fromVariantId)!;
      const to = variants.get(input.toVariantId)!;
      const lots = await this.openPacks(tx, { warehouseId: input.warehouseId, from, to, packs: input.packs, unitsPerPack: input.unitsPerPack, referenceType: 'break_pack' });
      scope.auditLog({ action: 'stock.break_pack', entityType: 'variant', entityId: from.id, after: { ...input } });
      await this.checkBelowMinimum(tx, scope, [from.id]);
      return { packs: input.packs, units: input.packs * input.unitsPerPack, lots };
    });
  }

  /**
   * Un pedido necesita `units` sueltos que no hay: abre cajas del mismo sobre, siempre la
   * presentación con más cajas en stock. Deja los movimientos ligados al pedido, para que en el
   * pedido se vea qué caja agarrar. Devuelve las cajas abiertas (vacío si no había ninguna).
   */
  async openPacksForOrder(tx: Tx, scope: UowScope, input: { warehouseId: string; unitVariantId: string; units: number; order: { id: string; number: string } }) {
    const sources = (await this.ledger.packSources(tx, input.warehouseId, [input.unitVariantId])).get(input.unitVariantId) ?? [];
    const plan = pickPacks(input.units, sources);
    if (!plan.length) return [];
    const variants = await this.variantsById(tx, [input.unitVariantId, ...plan.map((p) => p.variantId)]);
    const to = variants.get(input.unitVariantId)!;
    const opened: { variantId: string; sku: string; packs: number; units: number }[] = [];
    for (const p of plan) {
      await this.openPacks(tx, {
        warehouseId: input.warehouseId,
        from: variants.get(p.variantId)!,
        to,
        packs: p.packs,
        unitsPerPack: p.perPack,
        referenceType: 'sales_order',
        referenceId: input.order.id,
        reasonSuffix: ` para el pedido ${input.order.number}`,
        sellableOnly: true,
      });
      opened.push({ variantId: p.variantId, sku: p.sku, packs: p.packs, units: p.packs * p.perPack });
    }
    scope.auditLog({ action: 'stock.auto_break_pack', entityType: 'order', entityId: input.order.id, after: { unit: to.sku, opened } });
    return opened;
  }

  /** Saca `packs` cajas por FEFO y entran los sueltos con el mismo lote. Devuelve cuántos lotes tocó. */
  private async openPacks(
    tx: Tx,
    input: {
      warehouseId: string;
      from: { id: string; sku: string; cost: number };
      to: { id: string; sku: string };
      packs: number;
      unitsPerPack: number;
      referenceType: string;
      referenceId?: string;
      reasonSuffix?: string;
      /** Solo lotes que se pueden vender (aprobados y sin vencer). */
      sellableOnly?: boolean;
    },
  ) {
    const { from, to } = input;
    const rows = await tx.$queryRaw<{ id: string; lot_id: string | null; code: string | null; expires_at: Date | null; sellable: boolean; available: number }[]>`
      SELECT s.id, s.lot_id, l.code, l.expires_at, (s.on_hand - s.reserved)::float AS available,
             (l.id IS NULL OR (l.quality_status = 'APPROVED' AND (l.expires_at IS NULL OR l.expires_at > current_date))) AS sellable
      FROM stock_items s LEFT JOIN lots l ON l.id = s.lot_id
      WHERE s.warehouse_id = ${input.warehouseId}::uuid AND s.variant_id = ${from.id}::uuid
      FOR UPDATE OF s`;
    const balances = input.sellableOnly ? rows.filter((b) => b.sellable) : rows;
    const plan = allocateFefo(
      balances.map((b) => ({ stockItemId: b.id, lotId: b.lot_id, expiresAt: b.expires_at, available: b.available })),
      input.packs,
    );
    if (!plan) {
      const available = balances.reduce((s, b) => s + Math.max(b.available, 0), 0);
      throw new BusinessRuleError(`Hay ${available} cajas ${from.sku} disponibles y se quieren abrir ${input.packs}`);
    }
    const unitCost = Math.round((from.cost / input.unitsPerPack) * 10000) / 10000;
    const reason = `Apertura de ${input.packs} × ${from.sku} en ${to.sku} (${input.unitsPerPack} por caja)${input.reasonSuffix ?? ''}`;
    const ref = { referenceType: input.referenceType, referenceId: input.referenceId, reason };
    for (const part of plan) {
      const source = balances.find((b) => b.id === part.stockItemId)!;
      await this.ledger.post(tx, { warehouseId: input.warehouseId, variantId: from.id, lotId: part.lotId, type: 'PRODUCTION_OUT', quantity: -part.quantity, unitCost: from.cost, ...ref });
      const lot = source.code ? await this.ledger.lot(tx, to.id, source.code, source.expires_at) : null;
      await this.ledger.post(tx, {
        warehouseId: input.warehouseId,
        variantId: to.id,
        lotId: lot?.id ?? null,
        type: 'PRODUCTION_IN',
        quantity: part.quantity * input.unitsPerPack,
        unitCost,
        ...ref,
      });
    }
    return plan.length;
  }

  movements(query: MovementsQuery) {
    return this.uow.read(async (tx) => {
      const rows = await tx.stockMovement.findMany({
        where: { ...(query.warehouseId && { warehouseId: query.warehouseId }), ...(query.variantId && { variantId: query.variantId }) },
        orderBy: { occurredAt: 'desc' },
        take: query.limit,
        include: { warehouse: { select: { name: true } } },
      });
      const variantIds = [...new Set(rows.map((r) => r.variantId))];
      const lotIds = [...new Set(rows.flatMap((r) => (r.lotId ? [r.lotId] : [])))];
      const [variants, lots] = await Promise.all([
        tx.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, sku: true, name: true, product: { select: { name: true } } } }),
        tx.lot.findMany({ where: { id: { in: lotIds } }, select: { id: true, code: true } }),
      ]);
      const vById = new Map(variants.map((v) => [v.id, v]));
      const lotById = new Map(lots.map((l) => [l.id, l.code]));
      return rows.map((r) => {
        const v = vById.get(r.variantId);
        return {
          id: r.id,
          occurredAt: r.occurredAt,
          type: r.type,
          warehouse: r.warehouse.name,
          sku: v?.sku,
          name: v ? `${v.product.name} ${v.name}` : r.variantId,
          lot: r.lotId ? lotById.get(r.lotId) ?? null : null,
          quantity: Number(r.quantity),
          reason: r.reason,
          referenceType: r.referenceType,
          referenceId: r.referenceId,
        };
      });
    });
  }

  /** Emite stock.below_minimum para las presentaciones que quedaron en o bajo el punto de reposición. */
  async checkBelowMinimum(tx: Tx, scope: UowScope, variantIds: string[]) {
    if (!variantIds.length) return;
    const rows = await tx.$queryRaw<{ id: string; sku: string; available: number; reorder_point: number }[]>`
      SELECT v.id, v.sku, coalesce(sum(s.on_hand - s.reserved), 0)::float AS available, v.reorder_point::float AS reorder_point
      FROM product_variants v LEFT JOIN stock_items s ON s.variant_id = v.id
      WHERE v.id = ANY(${variantIds}::uuid[]) AND v.reorder_point > 0
      GROUP BY v.id
      HAVING coalesce(sum(s.on_hand - s.reserved), 0) <= v.reorder_point`;
    for (const r of rows) {
      scope.emit(new DomainEvent('stock.below_minimum', 'variant', r.id, { variantId: r.id, sku: r.sku, available: r.available, reorderPoint: r.reorder_point }));
    }
  }

  private async assertWarehouse(tx: Tx, warehouseId: string) {
    const w = await tx.warehouse.findFirst({ where: { id: warehouseId, isActive: true }, select: { branchId: true } });
    if (!w) throw new NotFoundError('Depósito', warehouseId);
    const { branchScope } = RequestContextStore.get();
    if (branchScope.length && !branchScope.includes(w.branchId)) throw new BusinessRuleError('No tenés acceso a ese depósito');
  }

  private async variantsById(tx: Tx, ids: string[]) {
    const rows = await tx.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, currentCost: true } });
    const map = new Map(rows.map((v) => [v.id, { id: v.id, sku: v.sku, cost: Number(v.currentCost) }]));
    const missing = ids.filter((id) => !map.has(id));
    if (missing.length) throw new NotFoundError('Presentación', missing[0]);
    return map;
  }
}
