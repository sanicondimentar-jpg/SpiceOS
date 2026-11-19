import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/domain/errors';
import { PrismaService, SystemPrismaService } from '../../../shared/prisma/prisma.service';
import { BASIC_COMBO, COMBOS } from '../domain/combos';
import type { Segment } from '../domain/recommendations';
import { RecommendationsService } from './recommendations.service';

export interface PublicCatalog {
  currency: string;
  updatedAt: string | null;
  /** Precio unitario (cantidad mínima 1) por nombre de lista: { "Mayorista": 14400, "Minorista": 900 }. */
  items: { sku: string; prices: Record<string, number> }[];
  /** Códigos recomendados por tipo de cliente, en orden (solo activos). Minorista: sueltos "-U". */
  recommendations: Record<Segment, string[]>;
  /** Combo básico para minoristas (lo leen las versiones de la web anteriores a `combos`). */
  combo: { name: string; items: { sku: string; quantity: number }[]; firstPurchaseDiscountPct: number };
  /**
   * Combos para minoristas, en orden. `price` null = suma de los sobres a precio Minorista; con precio fijo,
   * la web muestra ese precio y manda el combo por su código en el pedido.
   */
  combos: { code: string; name: string; items: { sku: string; quantity: number }[]; price: number | null; firstPurchaseDiscountPct: number }[];
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

    const [rows, recommendations] = await this.prisma.tx(
      (tx) =>
        Promise.all([
          tx.priceListItem.findMany({
            where: { minQuantity: 1, variant: { isActive: true, product: { isActive: true, deletedAt: null } } },
            select: { price: true, updatedAt: true, priceList: { select: { name: true } }, variant: { select: { sku: true } } },
            orderBy: { variant: { sku: 'asc' } },
          }),
          RecommendationsService.active(tx),
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
    return {
      currency: company.baseCurrency,
      updatedAt: updatedAt?.toISOString() ?? null,
      items: [...bySku].map(([sku, prices]) => ({ sku, prices })),
      recommendations,
      combo: { name: BASIC_COMBO.name, items: BASIC_COMBO.items.map((i) => ({ ...i })), firstPurchaseDiscountPct: BASIC_COMBO.firstPurchaseDiscountPct },
      combos: COMBOS.map((c) => ({ code: c.code, name: c.name, items: c.items.map((i) => ({ ...i })), price: c.price, firstPurchaseDiscountPct: c.firstPurchaseDiscountPct })),
    };
  }
}
