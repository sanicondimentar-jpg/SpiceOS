import type { Tx } from '../../../shared/prisma/prisma.service';
import { comboCode, firstPurchaseDiscountPct, type Combo } from '../domain/combos';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Los combos de la empresa (presentaciones con componentes), con precio Minorista y sus sobres. */
export async function loadCombos(tx: Tx): Promise<Combo[]> {
  const kits = await tx.productVariant.findMany({
    where: { kitComponents: { some: {} }, product: { deletedAt: null } },
    orderBy: { sku: 'desc' }, // COMBO-ESENCIAL antes que COMBO-CHEF
    select: {
      id: true,
      sku: true,
      name: true,
      isActive: true,
      product: { select: { name: true, isActive: true } },
      kitComponents: {
        select: {
          quantity: true,
          component: { select: { id: true, sku: true, name: true, isActive: true, product: { select: { name: true, isActive: true, deletedAt: true } } } },
        },
      },
    },
  });
  if (!kits.length) return [];
  const ids = [...kits.map((k) => k.id), ...kits.flatMap((k) => k.kitComponents.map((c) => c.component.id))];
  const prices = await tx.priceListItem.findMany({
    where: { minQuantity: 1, variantId: { in: ids }, priceList: { name: { equals: 'Minorista', mode: 'insensitive' } } },
    select: { variantId: true, price: true },
  });
  const price = new Map(prices.map((p) => [p.variantId, Number(p.price)]));
  return kits.map((k) => {
    const items = k.kitComponents.map((c) => ({
      variantId: c.component.id,
      sku: c.component.sku,
      product: c.component.product.name,
      presentation: c.component.name,
      quantity: Number(c.quantity),
      active: c.component.isActive && c.component.product.isActive && !c.component.product.deletedAt,
    }));
    const loose = items.map((i) => price.get(i.variantId));
    const looseTotal = loose.every((p) => p != null) ? round2(items.reduce((s, i, n) => s + loose[n]! * i.quantity, 0)) : null;
    const comboPrice = price.get(k.id) ?? null;
    return {
      variantId: k.id,
      sku: k.sku,
      code: comboCode(k.sku),
      name: k.product.name,
      presentation: k.name,
      items,
      price: comboPrice,
      looseTotal,
      firstPurchaseDiscountPct: firstPurchaseDiscountPct(k.sku),
      available: k.isActive && k.product.isActive && comboPrice != null && items.every((i) => i.active),
    };
  });
}
