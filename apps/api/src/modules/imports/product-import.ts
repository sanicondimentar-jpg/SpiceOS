import { variantSchema, type ImportRowError, type VariantInput } from '@spiceos/contracts';
import { parseNumber, type SheetRow } from './spreadsheet';

export const PRODUCT_COLUMNS: Record<string, string[]> = {
  productCode: ['código producto', 'codigo producto', 'código', 'codigo', 'cod producto'],
  productName: ['producto', 'nombre', 'nombre producto', 'descripción', 'descripcion'],
  variantName: ['presentación', 'presentacion', 'envase', 'formato'],
  sku: ['sku', 'código presentación', 'codigo presentacion', 'cod presentacion'],
  netWeightKg: ['peso kg', 'peso (kg)', 'kg', 'peso neto kg', 'peso'],
  unit: ['unidad', 'unidad de venta'],
  gtin: ['ean', 'gtin', 'código de barras', 'codigo de barras'],
  cost: ['costo', 'costo unitario', 'costo neto'],
  price: ['precio', 'precio lista', 'precio de lista'],
  minMarginPct: ['margen mínimo', 'margen minimo', 'margen mínimo %', 'margen minimo %'],
  category: ['categoría', 'categoria', 'rubro'],
  origin: ['origen', 'país de origen', 'pais de origen'],
  shelfLifeDays: ['vida útil días', 'vida util dias', 'vida útil', 'vida util', 'vencimiento días', 'vencimiento dias'],
};

/** "precio mayorista", "precio gastronomía"… cargan la lista de ese nombre. */
export const PRODUCT_PREFIX_FIELDS = ['precio'];

export const PRODUCT_TEMPLATE_HEADERS = [
  'Código producto', 'Producto', 'Presentación', 'SKU', 'Peso kg', 'Unidad', 'EAN', 'Costo', 'Precio',
  'Margen mínimo %', 'Categoría', 'Origen', 'Vida útil días',
];

export interface ProductRowResult {
  row: number;
  productCode?: string;
  productName?: string;
  category?: string;
  origin?: string;
  shelfLifeDays?: number;
  variant?: VariantInput;
  /** Precios por lista: clave "default" para la columna "Precio", o el nombre de lista de "Precio <lista>". */
  prices: { list: string; price: number }[];
  errors: ImportRowError[];
}

/** Una fila = una presentación. Las filas con el mismo código de producto se agrupan. */
export function mapProductRow({ row, values }: SheetRow, extraColumns: Record<string, string>): ProductRowResult {
  const errors: ImportRowError[] = [];
  const err = (field: string, message: string) => errors.push({ row, field, message });
  const num = (field: string, opts: { min?: number; required?: boolean } = {}) => {
    const raw = values[field];
    if (raw == null) {
      if (opts.required) err(field, `Falta ${field}`);
      return undefined;
    }
    const n = parseNumber(raw);
    if (n === null || (opts.min !== undefined && n < opts.min)) {
      err(field, `Número inválido en ${field}: ${raw}`);
      return undefined;
    }
    return n;
  };

  if (!values.productCode) err('productCode', 'Falta el código de producto');
  if (!values.productName) err('productName', 'Falta el nombre del producto');
  if (!values.sku) err('sku', 'Falta el SKU de la presentación');

  // Si no viene el peso, se intenta leer de la presentación: "500 g", "1 kg", "Bolsa 25 kg".
  let netWeightKg = num('netWeightKg', { min: 0 });
  if (netWeightKg === undefined && values.variantName) netWeightKg = weightFromName(values.variantName) ?? undefined;
  if (netWeightKg === undefined && !errors.some((e) => e.field === 'netWeightKg')) err('netWeightKg', 'Falta el peso en kg');

  const unitRaw = values.unit?.toUpperCase();
  const unit = !unitRaw ? 'UN' : ['KG', 'KILO', 'KILOS'].includes(unitRaw) ? 'KG' : ['UN', 'UNIDAD', 'U'].includes(unitRaw) ? 'UN' : null;
  if (unit === null) err('unit', `Unidad desconocida: ${values.unit} (usá UN o KG)`);

  const cost = num('cost', { min: 0 }) ?? 0;
  const minMarginPct = num('minMarginPct', { min: 0 }) ?? 0;
  const shelfLifeDays = num('shelfLifeDays', { min: 1 });

  const prices: ProductRowResult['prices'] = [];
  const base = num('price', { min: 0 });
  if (base !== undefined) prices.push({ list: 'default', price: base });
  for (const [key, label] of Object.entries(extraColumns)) {
    const n = num(key, { min: 0 });
    if (n !== undefined) prices.push({ list: label, price: n });
  }

  let variant: VariantInput | undefined;
  if (!errors.length) {
    const parsed = variantSchema.safeParse({
      sku: values.sku!.toUpperCase(),
      name: values.variantName ?? `${netWeightKg} kg`,
      gtin: values.gtin,
      unit,
      netWeightKg,
      cost,
      minMarginPct,
    });
    if (parsed.success) variant = parsed.data;
    else for (const issue of parsed.error.issues) err(String(issue.path[0]), issue.message);
  }

  return {
    row,
    productCode: values.productCode?.toUpperCase(),
    productName: values.productName,
    category: values.category,
    origin: values.origin,
    shelfLifeDays: shelfLifeDays !== undefined ? Math.round(shelfLifeDays) : undefined,
    variant: errors.length ? undefined : variant,
    prices,
    errors,
  };
}

export function weightFromName(name: string): number | null {
  const m = name.toLowerCase().replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|kilo|kilos|g|gr|grs|gramos)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].startsWith('k') ? n : n / 1000;
}
