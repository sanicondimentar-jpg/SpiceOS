import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS } from '@spiceos/contracts';
import { AiTool } from '../../shared/ai/ai-tool.decorator';
import { UnitOfWork } from '../../shared/unit-of-work';
import { PriceListsService } from './application/price-lists.service';
import { CertificationsService } from './application/certifications.service';

@Injectable()
export class CatalogAiTools {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly priceLists: PriceListsService,
    private readonly certifications: CertificationsService,
  ) {}

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

  @AiTool({
    name: 'catalog_margin_alerts',
    description:
      'Precios de una lista de precios que quedan por debajo del margen mínimo de su presentación (por ejemplo después de un aumento de costo). Sin priceListId usa la lista por defecto.',
    input: z.object({ priceListId: z.string().uuid().optional() }),
    permissions: [PERMISSIONS.catalog.costRead],
    agents: ['pricing', 'executive'],
  })
  async marginAlerts({ priceListId }: { priceListId?: string }) {
    const id = priceListId ?? (await this.uow.read((tx) => tx.priceList.findFirst({ where: { isDefault: true }, select: { id: true } })))?.id;
    if (!id) return { message: 'No hay lista de precios por defecto' };
    const list = await this.priceLists.items(id);
    return { priceList: list.name, alerts: list.items.filter((i) => 'belowMinMargin' in i && i.belowMinMargin) };
  }

  @AiTool({
    name: 'catalog_reprice_preview',
    description:
      'Simula recalcular los precios de una lista como costo × factor (ej. 1.55 = costo + 55 %), redondeando hacia arriba. No guarda nada: devuelve precio actual, nuevo, variación y margen por presentación.',
    input: z.object({
      priceListId: z.string().uuid(),
      factor: z.number().min(1).max(20),
      roundTo: z.number().positive().default(10),
    }),
    permissions: [PERMISSIONS.catalog.costRead],
    agents: ['pricing'],
  })
  repricePreview(input: { priceListId: string; factor: number; roundTo: number }) {
    return this.priceLists.reprice(input.priceListId, { ...input, dryRun: true });
  }

  @AiTool({
    name: 'catalog_reprice_apply',
    description: 'Aplica a una lista de precios el recálculo costo × factor. Mostrale antes al usuario la vista previa (catalog_reprice_preview).',
    input: z.object({
      priceListId: z.string().uuid(),
      factor: z.number().min(1).max(20),
      roundTo: z.number().positive().default(10),
    }),
    permissions: [PERMISSIONS.catalog.write, PERMISSIONS.catalog.costRead],
    agents: ['pricing'],
    requiresConfirmation: true,
  })
  repriceApply(input: { priceListId: string; factor: number; roundTo: number }) {
    return this.priceLists.reprice(input.priceListId, { ...input, dryRun: false });
  }

  @AiTool({
    name: 'catalog_expiring_certifications',
    description: 'Certificados de producto (Sin TACC, Kosher, etc.) vencidos o que vencen en los próximos N días.',
    input: z.object({ days: z.number().int().min(0).max(365).default(60) }),
    permissions: [PERMISSIONS.catalog.read],
    agents: ['documents', 'executive', 'commercial'],
  })
  expiringCertifications({ days }: { days: number }) {
    return this.certifications.expiring(days);
  }
}
