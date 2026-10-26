import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS } from '@spiceos/contracts';
import { AiTool } from '../../shared/ai/ai-tool.decorator';
import { UnitOfWork } from '../../shared/unit-of-work';

@Injectable()
export class InventoryAiTools {
  constructor(private readonly uow: UnitOfWork) {}

  @AiTool({
    name: 'inventory_below_minimum',
    description: 'Variantes cuyo stock disponible está por debajo del punto de reposición, con consumo promedio diario de 90 días y días de cobertura.',
    input: z.object({ warehouseId: z.string().uuid().optional() }),
    permissions: [PERMISSIONS.inventory.read],
    agents: ['inventory', 'purchasing', 'executive'],
  })
  belowMinimum({ warehouseId }: { warehouseId?: string }) {
    return this.uow.read((tx) =>
      tx.$queryRaw`
        WITH stock AS (
          SELECT variant_id, sum(on_hand - reserved) AS available
          FROM stock_items
          WHERE ${warehouseId ?? null}::uuid IS NULL OR warehouse_id = ${warehouseId ?? null}::uuid
          GROUP BY variant_id
        ), usage AS (
          SELECT variant_id, -sum(quantity) / 90.0 AS daily
          FROM stock_movements WHERE type = 'SALE_DISPATCH' AND occurred_at > now() - interval '90 days'
          GROUP BY variant_id
        )
        SELECT v.id AS variant_id, v.sku, p.name AS product, v.name AS presentation,
               coalesce(s.available, 0)::float AS available, v.reorder_point::float AS reorder_point,
               round(coalesce(u.daily, 0), 2)::float AS daily_usage,
               CASE WHEN coalesce(u.daily, 0) > 0 THEN floor(coalesce(s.available, 0) / u.daily)::int END AS days_of_cover
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        LEFT JOIN stock s ON s.variant_id = v.id
        LEFT JOIN usage u ON u.variant_id = v.id
        WHERE v.is_active AND coalesce(s.available, 0) <= v.reorder_point
        ORDER BY days_of_cover NULLS FIRST LIMIT 100`,
    );
  }

  @AiTool({
    name: 'inventory_expiring_lots',
    description: 'Lotes con stock que vencen dentro de N días: producto, lote, depósito, cantidad y fecha de vencimiento.',
    input: z.object({ days: z.number().int().min(1).max(365).default(60) }),
    permissions: [PERMISSIONS.inventory.read],
    agents: ['inventory', 'commercial', 'executive'],
  })
  expiringLots({ days }: { days: number }) {
    return this.uow.read((tx) =>
      tx.$queryRaw`
        SELECT l.code AS lot, p.name AS product, v.name AS presentation, w.name AS warehouse,
               s.on_hand::float AS quantity, l.expires_at
        FROM lots l
        JOIN stock_items s ON s.lot_id = l.id AND s.on_hand > 0
        JOIN warehouses w ON w.id = s.warehouse_id
        JOIN product_variants v ON v.id = l.variant_id
        JOIN products p ON p.id = v.product_id
        WHERE l.expires_at <= current_date + make_interval(days => ${days}::int)
        ORDER BY l.expires_at`,
    );
  }
}
