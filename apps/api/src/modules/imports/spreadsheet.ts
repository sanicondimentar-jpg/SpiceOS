import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { BusinessRuleError } from '../../shared/domain/errors';

export const MAX_ROWS = 5000;

export interface SheetRow {
  row: number; // número de fila en la planilla
  values: Record<string, string>; // clave = campo interno, valor = texto de la celda
}

export interface ParsedSheet {
  rows: SheetRow[];
  unknownColumns: string[];
  /** Columnas "precio <lista>" encontradas: nombre de lista tal como vino en el encabezado. */
  extraColumns: Record<string, string>;
}

/** Normaliza un encabezado: minúsculas, sin acentos ni signos. "Razón Social" → "razon social". */
export function normalizeHeader(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Lee la primera hoja de un .xlsx o un .csv y traduce encabezados con los alias de cada campo.
 * `prefixFields` captura columnas con prefijo, por ejemplo "precio mayorista" → extraColumns.
 */
export async function parseSpreadsheet(
  file: { buffer: Buffer; originalname: string },
  aliases: Record<string, string[]>,
  prefixFields: string[] = [],
): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  const name = file.originalname.toLowerCase();
  let sheet: ExcelJS.Worksheet | undefined;
  try {
    if (name.endsWith('.csv')) {
      const text = file.buffer.toString('utf8').replace(/^﻿/, '');
      // Las planillas en español suelen exportar CSV con ";" como separador.
      const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
      const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
      sheet = await workbook.csv.read(Readable.from([text]), { parserOptions: { delimiter } });
    } else if (name.endsWith('.xlsx')) {
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
      sheet = workbook.worksheets[0];
    } else {
      throw new BusinessRuleError('Formato no soportado: subí un archivo .xlsx o .csv');
    }
  } catch (err) {
    if (err instanceof BusinessRuleError) throw err;
    throw new BusinessRuleError('No se pudo leer la planilla: revisá que no esté dañada ni protegida');
  }
  if (!sheet || sheet.rowCount < 2) throw new BusinessRuleError('La planilla está vacía o no tiene filas debajo del encabezado');
  if (sheet.rowCount - 1 > MAX_ROWS) throw new BusinessRuleError(`La planilla tiene más de ${MAX_ROWS} filas; dividila en partes`);

  const lookup = new Map<string, string>();
  for (const [field, names] of Object.entries(aliases)) for (const n of names) lookup.set(normalizeHeader(n), field);

  const columns = new Map<number, string>();
  const unknownColumns: string[] = [];
  const extraColumns: Record<string, string> = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const raw = cellText(cell.value);
    const header = normalizeHeader(raw);
    if (!header) return;
    const field = lookup.get(header);
    if (field) return void columns.set(col, field);
    const prefix = prefixFields.find((p) => header.startsWith(`${p} `));
    if (prefix) {
      const key = `${prefix}:${header.slice(prefix.length + 1)}`;
      extraColumns[key] = raw.trim().slice(raw.trim().toLowerCase().indexOf(' ') + 1);
      return void columns.set(col, key);
    }
    unknownColumns.push(raw);
  });

  const rows: SheetRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Record<string, string> = {};
    columns.forEach((field, col) => {
      const text = cellText(row.getCell(col).value).trim();
      if (text) values[field] = text;
    });
    if (Object.keys(values).length) rows.push({ row: rowNumber, values });
  });
  return { rows, unknownColumns, extraColumns };
}

/** Texto de una celda de ExcelJS: fórmulas, hipervínculos, texto enriquecido y fechas. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text);
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('error' in value) return '';
  }
  return String(value);
}

/** Números con formato argentino ("1.234,56") o inglés ("1234.56"). Null si no es número. */
export function parseNumber(text: string | undefined): number | null {
  if (text == null || text === '') return null;
  let t = text.replace(/[$\s%]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
