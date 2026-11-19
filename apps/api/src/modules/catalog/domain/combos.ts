/**
 * Combos para minoristas: sobres sueltos ("-U") que se venden juntos. Los muestran la web y el asistente de
 * WhatsApp, y al venderse cada sobre va como una línea del pedido (así descuenta el stock de cada uno).
 * - Sin `price`: el combo vale la suma de los sobres a precio de lista.
 * - Con `price`: precio fijo; ese precio se reparte entre los sobres en proporción a su precio de lista.
 */
export interface ComboDef {
  /** Código estable (lo usan la web y el asistente para pedirlo). */
  code: string;
  name: string;
  items: { sku: string; quantity: number }[];
  /** Precio fijo del combo; null = suma de los sobres. */
  price: number | null;
  /** Descuento sobre el combo en la primera compra del cliente (0 = sin descuento). */
  firstPurchaseDiscountPct: number;
}

/** Combo Chef (antes "Combo básico", renombrado por Nacho 19/11/2026): 40 sobres de los 4 que más rotan. */
export const BASIC_COMBO: ComboDef = {
  code: 'BASICO',
  name: 'Combo Chef',
  items: [
    { sku: '179-U', quantity: 10 }, // Pimienta negra molida, sobre 25 g
    { sku: '41-U', quantity: 10 }, // Pimentón seleccionado, sobre 25 g
    { sku: '141-U', quantity: 10 }, // Orégano en hojas, sobre 25 g
    { sku: '60-U', quantity: 10 }, // Ají molido, sobre 25 g
  ],
  price: null,
  firstPurchaseDiscountPct: 10,
};

/** Combo Esencial (Nacho, 19/11/2026): un sobre de 25 g de cada uno, a precio fijo. */
export const ESSENTIAL_COMBO: ComboDef = {
  code: 'ESENCIAL',
  name: 'Combo Esencial',
  items: [
    { sku: '179-U', quantity: 1 }, // Pimienta negra molida
    { sku: '159-U', quantity: 1 }, // Pimienta blanca molida
    { sku: '60-U', quantity: 1 }, // Ají molido (Valles Andinos del NOA)
    { sku: '41-U', quantity: 1 }, // Pimentón seleccionado
    { sku: '373-U', quantity: 1 }, // Ajo en polvo
    { sku: '105-U', quantity: 1 }, // Comino molido
    { sku: '330-U', quantity: 1 }, // Chimichurri seco
    { sku: '329-U', quantity: 1 }, // Mezcla para provenzal
    { sku: '50-U', quantity: 1 }, // Adobo para pizza
    { sku: '48-U', quantity: 1 }, // Condimento para arroz
  ],
  price: 10000,
  firstPurchaseDiscountPct: 0,
};

/** Los combos que se ofrecen hoy, en el orden en que se muestran. */
export const COMBOS: ComboDef[] = [ESSENTIAL_COMBO, BASIC_COMBO];

export const findCombo = (code: string) => COMBOS.find((c) => c.code === code.trim().toUpperCase()) ?? null;

export interface ComboLine {
  sku: string;
  quantity: number;
  listPrice: number;
  /** Precio de cada sobre dentro del combo: el de lista, o su parte del precio fijo. */
  unitPrice: number;
}

export interface PricedCombo {
  code: string;
  name: string;
  lines: ComboLine[];
  /** Precio del combo (sin el descuento de primera compra). */
  price: number;
  /** Lo que suman los sobres a precio de lista. */
  listTotal: number;
  firstPurchaseDiscountPct: number;
  firstPurchasePrice: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Precio del combo con los precios de lista vigentes. Null si falta algún sobre (no se ofrece).
 * Con precio fijo, cada sobre lleva su parte en pesos enteros y la suma da justo el precio del combo,
 * así el pedido no cambia aunque alguien lo vuelva a calcular.
 */
export function priceCombo(combo: ComboDef, listPrice: (sku: string) => number | null | undefined): PricedCombo | null {
  const base = combo.items.map((i) => ({ sku: i.sku, quantity: i.quantity, listPrice: listPrice(i.sku) }));
  if (base.some((b) => b.listPrice == null || !(b.listPrice > 0))) return null;
  const items = base as { sku: string; quantity: number; listPrice: number }[];
  const listTotal = round2(items.reduce((s, i) => s + i.listPrice * i.quantity, 0));

  let lines: ComboLine[];
  if (combo.price == null) {
    lines = items.map((i) => ({ ...i, unitPrice: i.listPrice }));
  } else {
    const ratio = combo.price / listTotal;
    const raw = items.map((i) => i.listPrice * ratio);
    const unit = raw.map((r) => Math.floor(r));
    let rest = Math.round(combo.price - unit.reduce((s, u, k) => s + u * items[k]!.quantity, 0));
    // Los pesos que sobran van a los sobres con mayor fracción (de a uno por unidad del sobre).
    const order = raw.map((r, k) => ({ k, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
    for (const { k } of order) {
      const q = items[k]!.quantity;
      if (rest >= q) {
        unit[k]! += 1;
        rest -= q;
      }
    }
    // Si todavía queda algo (cantidades que no dividen justo), va en centavos al primer sobre que lo admita.
    if (rest > 0) {
      const k = items.findIndex((i) => i.quantity === 1);
      if (k >= 0) unit[k] = round2(unit[k]! + rest);
    }
    lines = items.map((i, k) => ({ ...i, unitPrice: unit[k]! }));
  }
  const price = round2(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
  return {
    code: combo.code,
    name: combo.name,
    lines,
    price,
    listTotal,
    firstPurchaseDiscountPct: combo.firstPurchaseDiscountPct,
    firstPurchasePrice: round2(price * (1 - combo.firstPurchaseDiscountPct / 100)),
  };
}
