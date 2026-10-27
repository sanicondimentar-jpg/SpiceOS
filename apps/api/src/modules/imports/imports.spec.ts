import ExcelJS from 'exceljs';
import { CUSTOMER_COLUMNS, mapCustomerRow } from './customer-import';
import { PRODUCT_COLUMNS, PRODUCT_PREFIX_FIELDS, mapProductRow, weightFromName } from './product-import';
import { parseNumber, parseSpreadsheet } from './spreadsheet';

const lookups = {
  priceLists: new Map([['mayorista', '11111111-1111-4111-8111-111111111111']]),
  users: new Map([['vendedor@sani.com', '22222222-2222-4222-8222-222222222222']]),
};

describe('parseNumber', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['1234.56', 1234.56],
    ['1,234.56', 1234.56],
    ['$ 12.000', 12000],
    ['25%', 25],
    ['1.5', 1.5],
    ['abc', null],
  ])('%s → %s', (input, expected) => expect(parseNumber(input)).toBe(expected));
});

describe('parseSpreadsheet', () => {
  it('lee CSV con ";" y encabezados con acentos', async () => {
    const csv = 'Razón Social;CUIT;Teléfono;Columna rara\nParrilla SRL;20-12345678-6;011 4444-5555;x\n;;;\n';
    const sheet = await parseSpreadsheet({ buffer: Buffer.from(csv), originalname: 'clientes.csv' }, CUSTOMER_COLUMNS);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]).toEqual({ row: 2, values: { legalName: 'Parrilla SRL', taxId: '20-12345678-6', phone: '011 4444-5555' } });
    expect(sheet.unknownColumns).toEqual(['Columna rara']);
  });

  it('lee XLSX y columnas "Precio <lista>"', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('P');
    ws.addRow(['Código', 'Producto', 'SKU', 'Presentación', 'Costo', 'Precio Gastronomía']);
    ws.addRow(['ore', 'Orégano', 'ore-1kg', '1 kg', 5000, 9000]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const sheet = await parseSpreadsheet({ buffer, originalname: 'p.xlsx' }, PRODUCT_COLUMNS, PRODUCT_PREFIX_FIELDS);
    expect(sheet.extraColumns).toEqual({ 'precio:gastronomia': 'Gastronomía' });
    const row = mapProductRow(sheet.rows[0], sheet.extraColumns);
    expect(row.errors).toEqual([]);
    expect(row.productCode).toBe('ORE');
    expect(row.variant).toMatchObject({ sku: 'ORE-1KG', netWeightKg: 1, cost: 5000 });
    expect(row.prices).toEqual([{ list: 'Gastronomía', price: 9000 }]);
  });

  it('rechaza formatos que no son planillas', async () => {
    await expect(parseSpreadsheet({ buffer: Buffer.from('x'), originalname: 'a.pdf' }, CUSTOMER_COLUMNS)).rejects.toThrow('Formato no soportado');
  });
});

describe('mapCustomerRow', () => {
  it('interpreta una fila completa', () => {
    const r = mapCustomerRow(
      {
        row: 2,
        values: {
          legalName: 'Parrilla SRL', taxId: '20123456786', taxCondition: 'Responsable Inscripto', phone: '011 15-4444-5555',
          paymentTermsDays: '30 días', creditLimit: '1.500.000', priceList: 'Mayorista', owner: 'Vendedor@sani.com',
          contactName: 'Juana', tags: 'gastro; vip',
        },
      },
      lookups,
    );
    expect(r.errors).toEqual([]);
    expect(r.input).toMatchObject({
      taxId: '20-12345678-6', taxCondition: 'RI', paymentTermsDays: 30, creditLimit: 1_500_000,
      priceListId: '11111111-1111-4111-8111-111111111111', ownerId: '22222222-2222-4222-8222-222222222222', tags: ['gastro', 'vip'], source: 'import',
    });
    expect(r.contact).toMatchObject({ fullName: 'Juana', phone: '011 15-4444-5555' });
  });

  it('informa cada error con su campo', () => {
    const r = mapCustomerRow({ row: 7, values: { taxId: '20-12345678-0', taxCondition: 'otro', priceList: 'Minorista' } }, lookups);
    expect(r.input).toBeUndefined();
    expect(r.errors.map((e) => e.field).sort()).toEqual(['legalName', 'priceList', 'taxCondition', 'taxId']);
    expect(r.errors.every((e) => e.row === 7)).toBe(true);
  });

  it('acepta "contado" como plazo 0', () => {
    expect(mapCustomerRow({ row: 2, values: { legalName: 'X SA', paymentTermsDays: 'Contado' } }, lookups).input?.paymentTermsDays).toBe(0);
  });
});

describe('mapProductRow', () => {
  it('toma el peso de la presentación cuando falta la columna', () => {
    const r = mapProductRow({ row: 2, values: { productCode: 'pim', productName: 'Pimentón', sku: 'pim-500', variantName: 'Bolsa 500 g', price: '4.500' } }, {});
    expect(r.errors).toEqual([]);
    expect(r.variant).toMatchObject({ netWeightKg: 0.5, unit: 'UN' });
    expect(r.prices).toEqual([{ list: 'default', price: 4500 }]);
  });

  it('exige código, nombre, SKU y peso', () => {
    const r = mapProductRow({ row: 3, values: { cost: '-5' } }, {});
    expect(r.errors.map((e) => e.field).sort()).toEqual(['cost', 'netWeightKg', 'productCode', 'productName', 'sku']);
  });

  it('lee pesos en kg y gramos', () => {
    expect(weightFromName('Bolsa 25 kg')).toBe(25);
    expect(weightFromName('100 g')).toBe(0.1);
    expect(weightFromName('1,5 kilos')).toBe(1.5);
    expect(weightFromName('Frasco')).toBeNull();
  });
});
