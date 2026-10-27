import type { ImportRowError } from '@spiceos/contracts';
import { lotCodeFor } from '../inventory/lot-code';
import { parseNumber, type SheetRow } from './spreadsheet';

export const STOCK_COLUMNS: Record<string, string[]> = {
  sku: ['sku', 'código', 'codigo', 'código presentación', 'codigo presentacion', 'cod'],
  quantity: ['cantidad', 'stock', 'existencia', 'unidades', 'saldo'],
  warehouse: ['depósito', 'deposito', 'código depósito', 'codigo deposito', 'almacén', 'almacen'],
  lot: ['lote', 'nro lote', 'número de lote', 'numero de lote'],
  expiresAt: ['vencimiento', 'vence', 'fecha de vencimiento', 'fecha vencimiento'],
  cost: ['costo', 'costo unitario'],
  // Columnas de referencia de la planilla precargada: se leen pero no se usan.
  label: ['producto', 'presentación', 'presentacion', 'descripción', 'descripcion'],
};

export const STOCK_TEMPLATE_HEADERS = ['SKU', 'Producto', 'Presentación', 'Cantidad', 'Lote', 'Vencimiento', 'Depósito'];

/** En la planilla precargada, las presentaciones sin stock quedan con la cantidad vacía: no se importan. */
export function isBlankStockRow({ values }: SheetRow): boolean {
  return !values.quantity && !values.lot && !values.expiresAt && !values.cost;
}

export interface StockRowResult {
  row: number;
  sku?: string;
  quantity?: number;
  warehouse?: string;
  lot?: string;
  expiresAt?: Date;
  cost?: number;
  errors: ImportRowError[];
}

/** Una fila = el saldo contado de una presentación en un depósito (y lote, si lo hay). */
export function mapStockRow({ row, values }: SheetRow): StockRowResult {
  const errors: ImportRowError[] = [];
  const err = (field: string, message: string) => errors.push({ row, field, message });

  if (!values.sku) err('sku', 'Falta el SKU');
  const quantity = parseNumber(values.quantity);
  if (values.quantity == null) err('quantity', 'Falta la cantidad');
  else if (quantity === null || quantity < 0) err('quantity', `Cantidad inválida: ${values.quantity}`);

  const expiresAt = values.expiresAt ? parseDate(values.expiresAt) : undefined;
  if (values.expiresAt && !expiresAt) err('expiresAt', `Fecha de vencimiento inválida: ${values.expiresAt} (usá dd/mm/aaaa)`);

  const cost = values.cost != null ? parseNumber(values.cost) : undefined;
  if (cost === null || (cost !== undefined && cost < 0)) err('cost', `Costo inválido: ${values.cost}`);

  return {
    row,
    sku: values.sku?.toUpperCase(),
    quantity: quantity ?? undefined,
    warehouse: values.warehouse?.toUpperCase(),
    lot: lotCodeFor(values.lot, expiresAt),
    expiresAt: expiresAt ?? undefined,
    cost: cost ?? undefined,
    errors,
  };
}

/** "2027-03-31" (celda de fecha) o "31/03/2027", "31-3-27". */
export function parseDate(text: string): Date | null {
  let y: number, m: number, d: number;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const local = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (local) [d, m, y] = [Number(local[1]), Number(local[2]), Number(local[3].length === 2 ? `20${local[3]}` : local[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}
