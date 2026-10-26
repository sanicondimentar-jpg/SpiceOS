import { Injectable } from '@nestjs/common';
import type { Tx } from '../../shared/prisma/prisma.service';
import { BusinessRuleError } from '../../shared/domain/errors';
import { Allocation, allocateFefo } from './fefo';

@Injectable()
export class InventoryFacade {
  /** Reserva stock por FEFO bloqueando las filas de saldo (SELECT ... FOR UPDATE). */
  async reserve(tx: Tx, warehouseId: string, variantId: string, quantity: number): Promise<Allocation[]> {
    const balances = await tx.$queryRaw<{ id: string; lot_id: string | null; expires_at: Date | null; available: number }[]>`
      SELECT s.id, s.lot_id, l.expires_at, (s.on_hand - s.reserved)::float AS available
      FROM stock_items s
      LEFT JOIN lots l ON l.id = s.lot_id
      WHERE s.warehouse_id = ${warehouseId}::uuid AND s.variant_id = ${variantId}::uuid
        AND (l.id IS NULL OR (l.quality_status = 'APPROVED' AND (l.expires_at IS NULL OR l.expires_at > current_date)))
      FOR UPDATE OF s`;
    const allocations = allocateFefo(
      balances.map((b) => ({ stockItemId: b.id, lotId: b.lot_id, expiresAt: b.expires_at, available: b.available })),
      quantity,
    );
    if (!allocations) throw new BusinessRuleError(`Stock insuficiente para la variante ${variantId}`);
    for (const a of allocations) {
      await tx.stockItem.update({ where: { id: a.stockItemId }, data: { reserved: { increment: a.quantity }, version: { increment: 1 } } });
    }
    return allocations;
  }
}
