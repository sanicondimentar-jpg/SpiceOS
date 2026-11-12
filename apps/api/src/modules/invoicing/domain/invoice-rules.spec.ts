import { caeDetail, formatInvoiceNumber, invoiceAmounts, invoiceKind, kindForLetter, qrUrl, receiverCondition, receiverDoc } from './invoice-rules';

describe('reglas de factura de ARCA', () => {
  it('monotributo emite siempre Factura C (11) y nota de crédito C (13)', () => {
    for (const r of ['RI', 'Monotributo', 'CF', 'Exento'] as const) expect(invoiceKind('MONOTRIBUTO', r)).toMatchObject({ type: 'C', arcaType: 11 });
    expect(invoiceKind('MONOTRIBUTO', 'CF', true)).toMatchObject({ type: 'NC-C', arcaType: 13, creditNote: true });
  });

  it('Responsable Inscripto emite A a inscriptos y monotributistas, B al resto', () => {
    expect(invoiceKind('RESPONSABLE_INSCRIPTO', 'RI')).toMatchObject({ type: 'A', arcaType: 1 });
    expect(invoiceKind('RESPONSABLE_INSCRIPTO', 'Monotributo')).toMatchObject({ type: 'A', arcaType: 1 });
    expect(invoiceKind('RESPONSABLE_INSCRIPTO', 'CF')).toMatchObject({ type: 'B', arcaType: 6 });
    expect(kindForLetter('B', true)).toMatchObject({ type: 'NC-B', arcaType: 8 });
  });

  it('lee la condición de IVA del cliente como la guarda el CRM', () => {
    expect(receiverCondition('RI')).toBe('RI');
    expect(receiverCondition('Monotributo')).toBe('Monotributo');
    expect(receiverCondition('Exento')).toBe('Exento');
    expect(receiverCondition(null)).toBe('CF');
  });

  it('identifica al receptor por CUIT, DNI o sin identificar', () => {
    expect(receiverDoc('20-36807092-1')).toEqual({ docType: 80, docNumber: '20368070921' });
    expect(receiverDoc('30.123.456')).toEqual({ docType: 96, docNumber: '30123456' });
    expect(receiverDoc('')).toEqual({ docType: 99, docNumber: '0' });
  });

  it('en la C el total es el precio de lista; en A y B se suma 21 %', () => {
    expect(invoiceAmounts('C', 14346.004)).toEqual({ net: 14346, vat: 0, total: 14346 });
    expect(invoiceAmounts('A', 1000)).toEqual({ net: 1000, vat: 210, total: 1210 });
  });

  it('arma el detalle de FECAESolicitar de una Factura C sin IVA', () => {
    const d = caeDetail({
      kind: invoiceKind('MONOTRIBUTO', 'CF'),
      pointOfSale: 3,
      number: 12,
      date: '2026-11-12',
      doc: { docType: 99, docNumber: '0' },
      receiver: 'CF',
      amounts: { net: 15000, vat: 0, total: 15000 },
    });
    expect(d).toMatchObject({ CbteFch: '20261112', ImpTotal: '15000.00', ImpNeto: '15000.00', ImpIVA: '0.00', CondicionIVAReceptorId: 5, DocTipo: 99 });
    expect(d).not.toHaveProperty('Iva');
    expect(d).not.toHaveProperty('CbtesAsoc');
  });

  it('la nota de crédito lleva el comprobante asociado y la A lleva la alícuota', () => {
    const nc = caeDetail({
      kind: kindForLetter('A', true),
      pointOfSale: 3,
      number: 1,
      date: '2026-11-12',
      doc: { docType: 80, docNumber: '20368070921' },
      receiver: 'RI',
      amounts: { net: 1000, vat: 210, total: 1210 },
      associated: { arcaType: 1, pointOfSale: 3, number: 7, issuerCuit: '20368070921', date: '2026-11-10' },
    });
    expect(nc.CbtesAsoc).toEqual({ CbteAsoc: { Tipo: 1, PtoVta: 3, Nro: 7, Cuit: '20368070921', CbteFch: '20261110' } });
    expect(nc.Iva).toEqual({ AlicIva: { Id: 5, BaseImp: '1000.00', Importe: '210.00' } });
  });

  it('numera y arma el QR de ARCA', () => {
    expect(formatInvoiceNumber(3, 125)).toBe('0003-00000125');
    const url = qrUrl({ date: '2026-11-12', issuerCuit: '20368070921', pointOfSale: 3, arcaType: 11, number: 125, total: 1500.5, docType: 99, docNumber: '0', cae: '76123456789012' });
    const data = JSON.parse(Buffer.from(url.split('?p=')[1]!, 'base64').toString());
    expect(data).toEqual({ ver: 1, fecha: '2026-11-12', cuit: 20368070921, ptoVta: 3, tipoCmp: 11, nroCmp: 125, importe: 1500.5, moneda: 'PES', ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: 'E', codAut: 76123456789012 });
  });
});
