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
    // Lista del cliente primero; lo que no tenga precio ahí se busca en la lista por defecto
    // (por ejemplo, un sobre suelto que solo está en la lista minorista).
    const defaultListId = (await tx.priceList.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id ?? null;
    const listIds = [...new Set([customerPriceListId, defaultListId].filter((x): x is string => !!x))];
    const variants = await tx.productVariant.findMany({
      where: { id: { in: ids }, isActive: true },
      include: {
        product: { select: { name: true } },
        priceListItems: listIds.length ? { where: { priceListId: { in: listIds } }, orderBy: { minQuantity: 'desc' } } : false,
      },
    });
    if (variants.length !== new Set(ids).size) throw new BusinessRuleError('Hay productos inexistentes o inactivos en el pedido');

    const qty = new Map(items.map((i) => [i.variantId, i.quantity]));
    return new Map(
      variants.map((v) => {
        const tiers = (v as typeof v & { priceListItems?: { priceListId: string; minQuantity: unknown; price: unknown }[] }).priceListItems ?? [];
        const pick = (listId: string | null) => tiers.find((t) => t.priceListId === listId && Number(t.minQuantity) <= (qty.get(v.id) ?? 0));
        const tier = pick(customerPriceListId) ?? pick(defaultListId);
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
