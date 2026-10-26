import { Injectable } from '@nestjs/common';
import type { Tx } from '../../shared/prisma/prisma.service';
import { BusinessRuleError } from '../../shared/domain/errors';

export interface PricedVariant {
  variantId: string;
  sku: string;
  name: string;
  listPrice: number | null;
  cost: number;
  minMarginPct: number;
}

/** Precios y costos vigentes (lista del cliente o la lista por defecto). Escala por volumen: toma el precio con mayor min_quantity <= cantidad. */
@Injectable()
export class CatalogFacade {
  async price(tx: Tx, items: { variantId: string; quantity: number }[], customerPriceListId: string | null): Promise<Map<string, PricedVariant>> {
    const ids = items.map((i) => i.variantId);
    // Sin lista asignada al cliente se usa la lista por defecto de la empresa.
    const priceListId =
      customerPriceListId ?? (await tx.priceList.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id ?? null;
    const variants = await tx.productVariant.findMany({
      where: { id: { in: ids }, isActive: true },
      include: {
        product: { select: { name: true } },
        priceListItems: priceListId ? { where: { priceListId }, orderBy: { minQuantity: 'desc' } } : false,
      },
    });
    if (variants.length !== new Set(ids).size) throw new BusinessRuleError('Hay productos inexistentes o inactivos en el pedido');

    const qty = new Map(items.map((i) => [i.variantId, i.quantity]));
    return new Map(
      variants.map((v) => {
        const tiers = (v as typeof v & { priceListItems?: { minQuantity: unknown; price: unknown }[] }).priceListItems ?? [];
        const tier = tiers.find((t) => Number(t.minQuantity) <= (qty.get(v.id) ?? 0));
        return [
          v.id,
          {
            variantId: v.id,
            sku: v.sku,
            name: `${v.product.name} ${v.name}`,
            listPrice: tier ? Number(tier.price) : null,
            cost: Number(v.currentCost),
            minMarginPct: Number(v.minMarginPct),
          },
        ];
      }),
    );
  }
}
