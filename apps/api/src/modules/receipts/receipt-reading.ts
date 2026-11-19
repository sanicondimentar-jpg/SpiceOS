import type { ReceiptReading, ReceiptReadingLine } from '@spiceos/contracts';

/** Presentación del catálogo tal como se le muestra al modelo para que elija el SKU. */
export interface CatalogVariant {
  id: string;
  sku: string;
  product: string;
  presentation: string;
  cost: number | null;
}

/** Lo que devuelve el modelo, antes de cruzarlo con el catálogo. */
export interface RawReading {
  reference: string | null;
  date: string | null;
  supplier: string | null;
  discountPct: number | null;
  total: number | null;
  lines: { text: string; quantity: number | null; unitPrice: number | null; sku: string | null }[];
}

const nullable = (type: string) => ({ type: [type, 'null'] });

export const RAW_READING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reference', 'date', 'supplier', 'discountPct', 'total', 'lines'],
  properties: {
    reference: nullable('string'),
    date: nullable('string'),
    supplier: nullable('string'),
    discountPct: nullable('number'),
    total: nullable('number'),
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'quantity', 'unitPrice', 'sku'],
        properties: { text: { type: 'string' }, quantity: nullable('number'), unitPrice: nullable('number'), sku: nullable('string') },
      },
    },
  },
} as const;

export const READER_SYSTEM = `Leés remitos y facturas de compra de mercadería de una distribuidora de condimentos argentina (Sabor a Casa).
Devolvés solo los datos pedidos; no inventes nada que no esté escrito.

- reference: número de remito o factura si figura (ej. "0001-00012345"); si no hay número, null.
- date: fecha del documento en formato AAAA-MM-DD (las fechas están en formato argentino dd/mm/aaaa); null si no figura.
- supplier: nombre del proveedor si figura; null si no.
- discountPct: descuento general sobre el subtotal en porcentaje (ej. "20%" → 20); null si no hay.
- total: total final a pagar; null si no figura.
- lines: un renglón por producto, en el orden del documento:
  - text: el renglón tal como está escrito (producto, gramos o presentación).
  - quantity: cantidad de unidades de esa presentación (columna Cantidad). Si dice "3 kg de orégano" sin presentación, usá la bolsa de 1 kg con cantidad 3.
  - unitPrice: precio unitario ANTES del descuento general, como número (ej. "$ 11.885,48" → 11885.48); null si no figura.
  - sku: el SKU del catálogo que corresponde a ese producto y presentación (por ejemplo 1000 gramos = "Bolsa 1 kg"). Si no estás seguro entre dos productos parecidos o no está en el catálogo, null.

Usá números con punto decimal, sin separador de miles. Ignorá renglones vacíos, subtotales y totales.`;

export function catalogForPrompt(variants: CatalogVariant[]): string {
  return ['Catálogo (SKU | producto | presentación):', ...variants.map((v) => `${v.sku} | ${v.product} | ${v.presentation}`)].join('\n');
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function validDate(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

/** Cruza la lectura con el catálogo, aplica el descuento al costo y junta renglones repetidos. */
export function toReading(raw: RawReading, catalog: CatalogVariant[]): ReceiptReading {
  const bySku = new Map(catalog.map((v) => [v.sku.toUpperCase(), v]));
  const discount = raw.discountPct != null && raw.discountPct > 0 && raw.discountPct < 100 ? raw.discountPct : null;
  const lines = new Map<string, ReceiptReadingLine>();
  const unmatched: ReceiptReading['unmatched'] = [];

  for (const l of raw.lines ?? []) {
    const quantity = l.quantity != null && l.quantity > 0 ? l.quantity : null;
    const v = l.sku ? bySku.get(l.sku.trim().toUpperCase()) : undefined;
    if (!v || quantity == null) {
      if (l.text?.trim()) unmatched.push({ sourceText: l.text.trim(), quantity });
      continue;
    }
    const unitCost = l.unitPrice != null && l.unitPrice >= 0 ? round2(l.unitPrice * (1 - (discount ?? 0) / 100)) : null;
    const prev = lines.get(v.id);
    if (prev) {
      prev.quantity += quantity;
      prev.sourceText += ` + ${l.text.trim()}`;
      prev.unitCost ??= unitCost;
      continue;
    }
    lines.set(v.id, {
      variantId: v.id,
      sku: v.sku,
      description: `${v.product} ${v.presentation}`,
      sourceText: l.text.trim(),
      quantity,
      unitCost,
      currentCost: v.cost,
    });
  }

  const documentDate = validDate(raw.date);
  const reference = raw.reference?.trim() || (documentDate ? `Remito ${documentDate.split('-').reverse().join('/')}` : null);
  return {
    reference,
    documentDate,
    supplierName: raw.supplier?.trim() || null,
    discountPct: discount,
    total: raw.total != null && raw.total >= 0 ? raw.total : null,
    lines: [...lines.values()],
    unmatched,
  };
}

export const READABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const;
export const MAX_READ_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
