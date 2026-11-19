import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/domain/errors';
import { PrismaService, SystemPrismaService } from '../../../shared/prisma/prisma.service';
import { loadCombos } from './combos';
import type { Segment } from '../domain/recommendations';
import { RecommendationsService } from './recommendations.service';

export interface PublicCatalog {
  currency: string;
  updatedAt: string | null;
  /** Precio unitario (cantidad mínima 1) por nombre de lista: { "Mayorista": 14400, "Minorista": 900 }. */
  items: { sku: string; prices: Record<string, number> }[];
  /** Códigos recomendados por tipo de cliente, en orden (solo activos). Minorista: sueltos "-U". */
  recommendations: Record<Segment, string[]>;
  /** Combo Chef (ex básico): lo leen las versiones de la web anteriores a `combos`. */
  combo: { name: string; items: { sku: string; quantity: number }[]; firstPurchaseDiscountPct: number };
  /**
   * Combos (productos con SKU propio "COMBO-…"), en orden, con su precio Minorista. La web muestra ese
   * precio y manda el combo por su código corto ("ESENCIAL") en el pedido.
   */
  combos: { code: string; sku: string; name: string; items: { sku: string; quantity: number }[]; price: number | null; firstPurchaseDiscountPct: number }[];
}

/**
 * Precios vigentes para la web pública. Solo presentaciones activas y precios por unidad:
 * nunca costos, márgenes ni stock.
 */
@Injectable()
export class PublicCatalogService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly prisma: PrismaService,
  ) {}

  async get(orgAlias: string): Promise<PublicCatalog> {
    const company = await this.system.company.findUnique({ where: { keycloakOrgId: orgAlias }, select: { id: true, status: true, baseCurrency: true } });
    if (!company || company.status !== 'ACTIVE') throw new NotFoundError('Empresa', orgAlias);

    const [rows, recommendations, allCombos] = await this.prisma.tx(
      (tx) =>
        Promise.all([
          tx.priceListItem.findMany({
            where: { minQuantity: 1, variant: { isActive: true, product: { isActive: true, deletedAt: null } } },
            select: { price: true, updatedAt: true, priceList: { select: { name: true } }, variant: { select: { sku: true } } },
            orderBy: { variant: { sku: 'asc' } },
          }),
          RecommendationsService.active(tx),
          loadCombos(tx),
        ]),
      company.id,
    );

    const bySku = new Map<string, Record<string, number>>();
    let updatedAt: Date | null = null;
    for (const r of rows) {
      const prices = bySku.get(r.variant.sku) ?? {};
      prices[r.priceList.name] = Number(r.price);
      bySku.set(r.variant.sku, prices);
      if (!updatedAt || r.updatedAt > updatedAt) updatedAt = r.updatedAt;
    }
    const combos = allCombos.filter((c) => c.available);
    const chef = combos.find((c) => c.code === 'CHEF');
    return {
      currency: company.baseCurrency,
      updatedAt: updatedAt?.toISOString() ?? null,
      items: [...bySku].map(([sku, prices]) => ({ sku, prices })),
      recommendations,
      combo: chef
        ? { name: chef.name, items: chef.items.map((i) => ({ sku: i.sku, quantity: i.quantity })), firstPurchaseDiscountPct: chef.firstPurchaseDiscountPct }
        : { name: 'Combo Chef', items: [], firstPurchaseDiscountPct: 0 },
      combos: combos.map((c) => ({
        code: c.code,
        sku: c.sku,
        name: c.name,
        items: c.items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        price: c.price,
        firstPurchaseDiscountPct: c.firstPurchaseDiscountPct,
      })),
    };
  }
}
