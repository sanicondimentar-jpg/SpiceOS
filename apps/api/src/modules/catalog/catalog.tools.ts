import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS } from '@spiceos/contracts';
import { AiTool } from '../../shared/ai/ai-tool.decorator';
import { UnitOfWork } from '../../shared/unit-of-work';

@Injectable()
export class CatalogAiTools {
  constructor(private readonly uow: UnitOfWork) {}

  @AiTool({
    name: 'catalog_search_products',
    description: 'Busca productos y presentaciones por nombre o SKU. Devuelve id de variante, stock disponible total y costo vigente.',
    input: z.object({ query: z.string(), limit: z.number().int().max(30).default(10) }),
    permissions: [PERMISSIONS.catalog.read],
  })
  search({ query, limit }: { query: string; limit: number }) {
    return this.uow.read((tx) =>
      tx.$queryRaw`
        SELECT v.id AS variant_id, v.sku, p.name AS product, v.name AS presentation, v.current_cost::float AS cost,
               coalesce(sum(s.on_hand - s.reserved), 0)::float AS available
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        LEFT JOIN stock_items s ON s.variant_id = v.id
        WHERE v.is_active AND (p.name ILIKE ${'%' + query + '%'} OR v.sku ILIKE ${'%' + query + '%'})
        GROUP BY v.id, p.name ORDER BY p.name LIMIT ${limit}`,
    );
  }

  @AiTool({
    name: 'catalog_product_profitability',
    description:
      'Ranking de rentabilidad por producto en un período: facturación, costo, margen bruto y margen %. Responde "¿qué productos son más rentables?".',
    input: z.object({
      days: z.number().int().min(1).max(730).default(90),
      orderBy: z.enum(['margin', 'margin_pct', 'revenue']).default('margin'),
      limit: z.number().int().max(50).default(15),
    }),
    permissions: [PERMISSIONS.catalog.costRead],
    agents: ['pricing', 'executive', 'commercial'],
  })
  profitability({ days, orderBy, limit }: { days: number; orderBy: string; limit: number }) {
    return this.uow.read(async (tx) => {
      const rows = await tx.$queryRaw<{ product: string; revenue: number; cost: number; margin: number; margin_pct: number; kg: number }[]>`
        SELECT p.name AS product,
               sum(l.line_total)::float AS revenue,
               sum(l.unit_cost * l.quantity)::float AS cost,
               sum(l.line_total - l.unit_cost * l.quantity)::float AS margin,
               CASE WHEN sum(l.line_total) > 0
                    THEN round(100 * sum(l.line_total - l.unit_cost * l.quantity) / sum(l.line_total), 2)::float END AS margin_pct,
               sum(l.quantity * v.net_weight_kg)::float AS kg
        FROM sales_order_lines l
        JOIN sales_orders o ON o.id = l.order_id
        JOIN product_variants v ON v.id = l.variant_id
        JOIN products p ON p.id = v.product_id
        WHERE o.status NOT IN ('DRAFT','CANCELLED') AND o.created_at > now() - make_interval(days => ${days}::int)
        GROUP BY p.name`;
      const key = orderBy as 'margin' | 'margin_pct' | 'revenue';
      return rows.sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0)).slice(0, limit);
    });
  }
}
