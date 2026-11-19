/**
 * Combos: presentaciones con SKU propio ("COMBO-ESENCIAL", "COMBO-CHEF") que se venden en una línea
 * (pedido y factura) y que al reservarse y despacharse descuentan stock de cada sobre que llevan
 * (tabla kit_components). Su precio está en las listas de precios como cualquier producto.
 * La web y el asistente los piden por su código corto ("ESENCIAL"), que es el SKU sin "COMBO-".
 */
export const COMBO_PREFIX = 'COMBO-';

/** Códigos viejos: "BASICO" es el Combo Chef (así lo mandaba la web antes de que tuviera SKU propio). */
const ALIASES: Record<string, string> = { BASICO: 'CHEF' };

export const comboSku = (code: string) => {
  const c = code.trim().toUpperCase().replace(/^COMBO-/, '');
  return `${COMBO_PREFIX}${ALIASES[c] ?? c}`;
};
export const comboCode = (sku: string) => (sku.toUpperCase().startsWith(COMBO_PREFIX) ? sku.slice(COMBO_PREFIX.length) : sku).toUpperCase();

/** Descuento en la primera compra del cliente (lo aplica quien revisa el pedido o el asistente). */
const FIRST_PURCHASE_DISCOUNT: Record<string, number> = {
  'COMBO-CHEF': 10, // el ex "Combo básico" (Nacho, 19/11/2026: se mantiene)
};
export const firstPurchaseDiscountPct = (sku: string) => FIRST_PURCHASE_DISCOUNT[sku.toUpperCase()] ?? 0;

export interface Combo {
  variantId: string;
  sku: string;
  /** Código corto: el SKU sin "COMBO-". */
  code: string;
  name: string;
  presentation: string;
  items: { variantId: string; sku: string; product: string; presentation: string; quantity: number; active: boolean }[];
  /** Precio de lista Minorista (null si no tiene). */
  price: number | null;
  /** Lo que suman los sobres sueltos a precio Minorista (null si falta alguno). */
  looseTotal: number | null;
  firstPurchaseDiscountPct: number;
  /** Activo y con todos sus sobres activos y con precio: se puede ofrecer. */
  available: boolean;
}
