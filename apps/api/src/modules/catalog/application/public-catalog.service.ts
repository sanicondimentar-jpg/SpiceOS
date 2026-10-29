import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/domain/errors';
import { PrismaService, SystemPrismaService } from '../../../shared/prisma/prisma.service';

export interface PublicCatalog {
  currency: string;
  updatedAt: string | null;
  /** Precio unitario (cantidad mínima 1) por nombre de lista: { "Mayorista": 14400, "Minorista": 900 }. */
  items: { sku: string; prices: Record<string, number> }[];
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

    const rows = await this.prisma.tx(
      (tx) =>
        tx.priceListItem.findMany({
          where: { minQuantity: 1, variant: { isActive: true, product: { isActive: true, deletedAt: null } } },
          select: { price: true, updatedAt: true, priceList: { select: { name: true } }, variant: { select: { sku: true } } },
          orderBy: { variant: { sku: 'asc' } },
        }),
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
    };
  }
}
