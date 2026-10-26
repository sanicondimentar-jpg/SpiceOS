/** Redondeo monetario a 2 decimales (half-up) para totales; los precios unitarios guardan 4. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineTotal(quantity: number, unitPrice: number, discountPct: number): number {
  return round2(quantity * unitPrice * (1 - discountPct / 100));
}

export function marginPct(price: number, cost: number): number {
  if (price <= 0) return 0;
  return round2(((price - cost) / price) * 100);
}
