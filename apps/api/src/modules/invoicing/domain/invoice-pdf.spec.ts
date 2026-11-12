import { renderPdf } from '../../catalog/domain/price-list-pdf';
import { buildInvoiceDoc, type InvoicePdfData } from './invoice-pdf';

const data: InvoicePdfData = {
  type: 'C',
  arcaType: 11,
  pointOfSale: 3,
  number: 12,
  issueDate: '2026-11-12',
  dueDate: '2026-11-12',
  cae: '76451234567890',
  caeDueDate: '2026-11-22',
  testing: false,
  issuer: { legalName: 'Ignacio Pérez', tradeName: 'Sabor a Casa', cuit: '20368070921', address: 'Calle 123, Tigre', condition: 'MONOTRIBUTO', grossIncomeId: null, activityStart: '2020-01-01' },
  receiver: { name: 'Almacén Don José', docType: 80, docNumber: '30712345678', condition: 'RI', address: null },
  saleCondition: 'Contado',
  lines: [{ sku: 'PIM-1KG', description: 'Pimentón Bolsa 1 kg', quantity: 2, unitPrice: 7500, discountPct: 0, lineTotal: 15000 }],
  net: 15000,
  vat: 0,
  total: 15000,
};

describe('factura en PDF', () => {
  it('lleva letra y código, CAE y QR', () => {
    const doc = JSON.stringify(buildInvoiceDoc(data));
    expect(doc).toContain('"text":"C"');
    expect(doc).toContain('COD. 11');
    expect(doc).toContain('0003-00000012');
    expect(doc).toContain('76451234567890');
    expect(doc).toContain('https://www.afip.gob.ar/fe/qr/?p=');
    expect(doc).toContain('Responsable Monotributo');
    expect(doc).not.toContain('SIN VALIDEZ');
  });

  it('se genera el archivo', async () => {
    const pdf = await renderPdf(buildInvoiceDoc({ ...data, testing: true }));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
