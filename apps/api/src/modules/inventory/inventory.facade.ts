import { Injectable } from '@nestjs/common';
import type { MovementType } from '@prisma/client';
import type { Tx } from '../../shared/prisma/prisma.service';
import { BusinessRuleError } from '../../shared/domain/errors';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { Allocation, allocateFefo } from './fefo';
import { openableUnits, unitsFromPack, type PackSource } from './pack-sources';

export interface MovementInput {
  warehouseId: string;
  variantId: string;
  lotId: string | null;
  type: MovementType;
  /** Positivo entra, negativo sale. */
  quantity: number;
  unitCost?: number | null;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
}

/** Un sobre dentro de un combo. */
export interface KitComponentRef {
  variantId: string;
  sku: string;
  /** Cuántos lleva cada combo. */
  quantity: number;
  cost: number;
}

/** Combos completos que se pueden armar con el disponible de cada componente. */
export function kitAvailable(components: { variantId: string; quantity: number }[], available: Map<string, number>): number {
  if (!components.length) return 0;
  return Math.max(0, Math.min(...components.map((c) => Math.floor((available.get(c.variantId) ?? 0) / c.quantity))));
}

/** Asignación guardada en una reserva: de qué saldo y lote sale cada parte. */
export interface StoredAllocation {
  stockItemId: string;
  lotId: string | null;
  quantity: number;
}

/**
 * Libro de stock. Toda variación de saldo pasa por acá y deja su movimiento;
 * los saldos se bloquean (FOR UPDATE) dentro de la transacción del caso de uso.
 */
@Injectable()
export class InventoryFacade {
  /** Reserva stock por FEFO bloqueando las filas de saldo (SELECT ... FOR UPDATE). */
  async reserve(tx: Tx, warehouseId: string, variantId: string, quantity: number, label = variantId): Promise<Allocation[]> {
    const balances = await this.lockBalances(tx, warehouseId, variantId);
    const allocations = allocateFefo(balances, quantity);
    if (!allocations) {
      const available = balances.reduce((s, b) => s + Math.max(b.available, 0), 0);
      throw new BusinessRuleError(`Stock insuficiente de ${label}: hay ${available} disponibles y se piden ${quantity}`);
    }
    await this.hold(tx, allocations);
    return allocations;
  }

  /** Reserva lo que haya hasta `quantity` y devuelve cuánto faltó (pedido con faltante). */
  async reserveUpTo(tx: Tx, warehouseId: string, variantId: string, quantity: number): Promise<{ allocations: Allocation[]; missing: number }> {
    const balances = await this.lockBalances(tx, warehouseId, variantId);
    const available = balances.reduce((s, b) => s + Math.max(b.available, 0), 0);
    const take = Math.min(available, quantity);
    const allocations = take > 0 ? allocateFefo(balances, take) ?? [] : [];
    await this.hold(tx, allocations);
    return { allocations, missing: Math.round((quantity - take) * 1000) / 1000 };
  }

  /** Devuelve al disponible lo reservado (pedido cancelado). */
  async release(tx: Tx, allocations: StoredAllocation[]) {
    for (const a of allocations) {
      await tx.stockItem.update({ where: { id: a.stockItemId }, data: { reserved: { decrement: a.quantity }, version: { increment: 1 } } });
    }
  }

  /** Descuenta del saldo lo reservado y deja el movimiento de salida (pedido despachado). */
  async consume(tx: Tx, allocations: (StoredAllocation & { variantId: string; unitCost: number })[], ref: { type: string; id: string }) {
    const ctx = RequestContextStore.get();
    for (const a of allocations) {
      const item = await tx.stockItem.update({
        where: { id: a.stockItemId },
        data: { onHand: { decrement: a.quantity }, reserved: { decrement: a.quantity }, version: { increment: 1 } },
      });
      await tx.stockMovement.create({
        data: {
          tenantId: ctx.tenantId,
          warehouseId: item.warehouseId,
          variantId: a.variantId,
          lotId: a.lotId,
          type: 'SALE_DISPATCH',
          quantity: -a.quantity,
          unitCost: a.unitCost,
          referenceType: ref.type,
          referenceId: ref.id,
          createdBy: ctx.actor,
        },
      });
    }
  }

  /** Suma o resta stock en un saldo (lo crea si no existe) y registra el movimiento. */
  async post(tx: Tx, m: MovementInput) {
    const ctx = RequestContextStore.get();
    const item = await this.lockItem(tx, m.warehouseId, m.variantId, m.lotId);
    const onHand = item ? Number(item.on_hand) : 0;
    const reserved = item ? Number(item.reserved) : 0;
    if (onHand + m.quantity < reserved) {
      throw new BusinessRuleError(
        m.quantity < 0 && onHand + m.quantity >= 0
          ? `No se puede bajar el saldo a ${onHand + m.quantity}: hay ${reserved} reservados para pedidos`
          : `Stock insuficiente: el saldo es ${onHand} y se quieren sacar ${-m.quantity}`,
      );
    }
    const stockItemId = item
      ? (await tx.stockItem.update({ where: { id: item.id }, data: { onHand: { increment: m.quantity }, version: { increment: 1 } } })).id
      : (
          await tx.stockItem.create({
            data: { tenantId: ctx.tenantId, warehouseId: m.warehouseId, variantId: m.variantId, lotId: m.lotId, onHand: m.quantity },
          })
        ).id;
    await tx.stockMovement.create({
      data: {
        tenantId: ctx.tenantId,
        warehouseId: m.warehouseId,
        variantId: m.variantId,
        lotId: m.lotId,
        type: m.type,
        quantity: m.quantity,
        unitCost: m.unitCost ?? null,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        reason: m.reason,
        createdBy: ctx.actor,
      },
    });
    return { stockItemId, onHand: onHand + m.quantity, reserved };
  }

  /** Lote de la variante por código; si no existe se crea con el vencimiento indicado. */
  async lot(tx: Tx, variantId: string, code: string, expiresAt?: Date | null) {
    const ctx = RequestContextStore.get();
    const existing = await tx.lot.findFirst({ where: { variantId, code } });
    if (existing) {
      if (expiresAt && existing.expiresAt && existing.expiresAt.getTime() !== expiresAt.getTime()) {
        throw new BusinessRuleError(`El lote ${code} ya existe con vencimiento ${existing.expiresAt.toISOString().slice(0, 10)}`);
      }
      if (expiresAt && !existing.expiresAt) return tx.lot.update({ where: { id: existing.id }, data: { expiresAt } });
      return existing;
    }
    return tx.lot.create({ data: { tenantId: ctx.tenantId, variantId, code, expiresAt: expiresAt ?? null } });
  }

  /** Componentes de los combos de la lista (los que no son combo no aparecen). */
  async kitComponents(tx: Tx, variantIds: string[]): Promise<Map<string, KitComponentRef[]>> {
    if (!variantIds.length) return new Map();
    const rows = await tx.kitComponent.findMany({
      where: { kitVariantId: { in: [...new Set(variantIds)] } },
      select: { kitVariantId: true, componentVariantId: true, quantity: true, component: { select: { sku: true, currentCost: true } } },
    });
    const out = new Map<string, KitComponentRef[]>();
    for (const r of rows) {
      const list = out.get(r.kitVariantId) ?? [];
      list.push({ variantId: r.componentVariantId, sku: r.component.sku, quantity: Number(r.quantity), cost: Number(r.component.currentCost) });
      out.set(r.kitVariantId, list);
    }
    return out;
  }

  /**
   * Disponible (existente − reservado) por variante en un depósito.
   * Un combo no tiene stock propio: alcanza para tantos combos como permita su componente más escaso.
   */
  async available(tx: Tx, warehouseId: string, variantIds: string[]): Promise<Map<string, number>> {
    if (!variantIds.length) return new Map();
    const kits = await this.kitComponents(tx, variantIds);
    const componentIds = [...kits.values()].flatMap((c) => c.map((x) => x.variantId));
    const ids = [...new Set([...variantIds.filter((id) => !kits.has(id)), ...componentIds])];
    const base = await this.stockAvailable(tx, warehouseId, ids);
    // Un suelto también cuenta los que salen de abrir cajas (el sistema las abre solo al confirmar).
    const sources = await this.packSources(tx, warehouseId, ids);
    for (const [unitId, list] of sources) base.set(unitId, (base.get(unitId) ?? 0) + openableUnits(list));
    for (const [kitId, comps] of kits) base.set(kitId, kitAvailable(comps, base));
    return base;
  }

  /**
   * Cajas de las que puede salir cada suelto ("-U"): las del mismo producto que traen ese mismo
   * sobre, paquete o frasco, con sus cajas disponibles. Los que no son sueltos no aparecen.
   */
  async packSources(tx: Tx, warehouseId: string, variantIds: string[]): Promise<Map<string, PackSource[]>> {
    const out = new Map<string, PackSource[]>();
    if (!variantIds.length) return out;
    const units = await tx.productVariant.findMany({
      where: { id: { in: [...new Set(variantIds)] }, sku: { endsWith: '-U', mode: 'insensitive' } },
      select: { id: true, sku: true, name: true, productId: true },
    });
    if (!units.length) return out;
    const packs = await tx.productVariant.findMany({
      where: { productId: { in: [...new Set(units.map((u) => u.productId))] }, isActive: true, NOT: { sku: { endsWith: '-U', mode: 'insensitive' } }, kitComponents: { none: {} } },
      select: { id: true, sku: true, name: true, productId: true },
    });
    const stock = await this.stockAvailable(tx, warehouseId, packs.map((p) => p.id));
    for (const u of units) {
      const list: PackSource[] = [];
      for (const p of packs.filter((x) => x.productId === u.productId)) {
        const perPack = unitsFromPack(u, p);
        if (perPack) list.push({ variantId: p.id, sku: p.sku, perPack, available: stock.get(p.id) ?? 0 });
      }
      if (list.length) out.set(u.id, list);
    }
    return out;
  }

  private async stockAvailable(tx: Tx, warehouseId: string, variantIds: string[]): Promise<Map<string, number>> {
    if (!variantIds.length) return new Map();
    const rows = await tx.$queryRaw<{ variant_id: string; available: number }[]>`
      SELECT s.variant_id, sum(s.on_hand - s.reserved)::float AS available
      FROM stock_items s
      LEFT JOIN lots l ON l.id = s.lot_id
      WHERE s.warehouse_id = ${warehouseId}::uuid AND s.variant_id = ANY(${variantIds}::uuid[])
        AND (l.id IS NULL OR (l.quality_status = 'APPROVED' AND (l.expires_at IS NULL OR l.expires_at > current_date)))
      GROUP BY s.variant_id`;
    return new Map(rows.map((r) => [r.variant_id, r.available]));
  }

  private async lockBalances(tx: Tx, warehouseId: string, variantId: string) {
    const rows = await tx.$queryRaw<{ id: string; lot_id: string | null; expires_at: Date | null; available: number }[]>`
      SELECT s.id, s.lot_id, l.expires_at, (s.on_hand - s.reserved)::float AS available
      FROM stock_items s
      LEFT JOIN lots l ON l.id = s.lot_id
      WHERE s.warehouse_id = ${warehouseId}::uuid AND s.variant_id = ${variantId}::uuid
        AND (l.id IS NULL OR (l.quality_status = 'APPROVED' AND (l.expires_at IS NULL OR l.expires_at > current_date)))
      FOR UPDATE OF s`;
    return rows.map((b) => ({ stockItemId: b.id, lotId: b.lot_id, expiresAt: b.expires_at, available: b.available }));
  }

  private async hold(tx: Tx, allocations: Allocation[]) {
    for (const a of allocations) {
      await tx.stockItem.update({ where: { id: a.stockItemId }, data: { reserved: { increment: a.quantity }, version: { increment: 1 } } });
    }
  }

  private async lockItem(tx: Tx, warehouseId: string, variantId: string, lotId: string | null) {
    const [row] = await tx.$queryRaw<{ id: string; on_hand: number; reserved: number }[]>`
      SELECT id, on_hand::float, reserved::float FROM stock_items
      WHERE warehouse_id = ${warehouseId}::uuid AND variant_id = ${variantId}::uuid
        AND lot_id IS NOT DISTINCT FROM ${lotId}::uuid
      FOR UPDATE`;
    return row ?? null;
  }
}
