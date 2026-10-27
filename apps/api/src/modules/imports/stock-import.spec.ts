import { isBlankStockRow, mapStockRow, parseDate } from './stock-import';

describe('mapStockRow', () => {
  it('lee SKU, cantidad, lote y vencimiento en formato argentino', () => {
    const r = mapStockRow({ row: 2, values: { sku: '50-u', quantity: '1.250', lot: 'L24', expiresAt: '31/03/2027', cost: '512,5' } });
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({ sku: '50-U', quantity: 1250, lot: 'L24', cost: 512.5 });
    expect(r.expiresAt?.toISOString().slice(0, 10)).toBe('2027-03-31');
  });

  it('marca cantidad negativa, fecha inválida y vencimiento sin lote', () => {
    const r = mapStockRow({ row: 3, values: { sku: 'X', quantity: '-2', expiresAt: '31/02/2027' } });
    expect(r.errors.map((e) => e.field).sort()).toEqual(['expiresAt', 'quantity']);
    const s = mapStockRow({ row: 4, values: { sku: 'X', quantity: '1', expiresAt: '2027-01-01' } });
    expect(s.errors.map((e) => e.field)).toEqual(['lot']);
  });
});

describe('parseDate', () => {
  it('acepta fechas de celda, dd/mm/aaaa y año de dos dígitos', () => {
    expect(parseDate('2027-03-31')?.toISOString().slice(0, 10)).toBe('2027-03-31');
    expect(parseDate('5-4-27')?.toISOString().slice(0, 10)).toBe('2027-04-05');
    expect(parseDate('31/04/2027')).toBeNull();
    expect(parseDate('mañana')).toBeNull();
  });
});

describe('isBlankStockRow', () => {
  it('ignora las filas precargadas que no se completaron', () => {
    expect(isBlankStockRow({ row: 2, values: { sku: '52', label: 'Bolsa 1 kg' } })).toBe(true);
    expect(isBlankStockRow({ row: 3, values: { sku: '52', quantity: '0' } })).toBe(false);
    expect(isBlankStockRow({ row: 4, values: { sku: '52', lot: 'L1' } })).toBe(false);
  });
});
