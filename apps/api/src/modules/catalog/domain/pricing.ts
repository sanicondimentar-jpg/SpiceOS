/** Reglas puras de precios del catálogo. */

/** Precio = costo × factor, redondeado hacia arriba al múltiplo indicado (precios "redondos" para el vendedor). */
export function priceFromCost(cost: number, factor: number, roundTo = 10): number {
  if (cost <= 0) return 0;
  const raw = cost * factor;
  return Math.ceil(raw / roundTo - 1e-9) * roundTo;
}

/** Margen bruto sobre precio de venta, en %. Null si no hay precio. */
export function marginPct(price: number | null, cost: number): number | null {
  if (!price || price <= 0) return null;
  return Math.round(((price - cost) / price) * 10000) / 100;
}

/** Variación porcentual de costo; null cuando no había costo previo. */
export function changePct(previous: number, next: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((next - previous) / previous) * 10000) / 100;
}

/** Mínimo precio que respeta el margen mínimo: costo / (1 - margen). */
export function minPriceForMargin(cost: number, minMarginPct: number): number {
  if (minMarginPct >= 100) return Number.POSITIVE_INFINITY;
  return cost / (1 - minMarginPct / 100);
}

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
