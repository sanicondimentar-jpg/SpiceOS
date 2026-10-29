/**
 * Reglas puras para cubrir faltantes de un pedido con compras al proveedor.
 * Los sobres sueltos ("50-U") no se compran: salen de abrir la caja ("50"),
 * así que el faltante de sueltos se traduce a cajas.
 */

/** SKU de la caja de la que sale un suelto ("50-U" → "50"); null si no es un suelto. */
export function packSkuOf(sku: string): string | null {
  return /-U$/i.test(sku) ? sku.slice(0, -2) : null;
}

/** Sobres por caja a partir del nombre de la presentación ("Caja 50 sobres × 25 g" → 50). */
export function unitsPerPack(name: string): number | null {
  const m = /(\d+)\s*sobres/i.exec(name);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Cajas a abrir con lo que hay en depósito y cajas a comprar para cubrir `missingUnits` sueltos. */
export function packsFor(missingUnits: number, perPack: number, packsAvailable: number): { open: number; buy: number } {
  const needed = Math.ceil(missingUnits / perPack - 1e-9);
  const open = Math.max(0, Math.min(Math.floor(packsAvailable), needed));
  return { open, buy: needed - open };
}
