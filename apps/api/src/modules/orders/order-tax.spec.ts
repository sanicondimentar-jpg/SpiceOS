import { orderTax, storedTax } from './order-tax';

describe('orderTax', () => {
  it('como Responsable Inscripto suma 21 % de IVA solo cuando el pedido se factura', () => {
    expect(orderTax(14346, true, true)).toEqual({ withInvoice: true, taxTotal: 3012.66, grandTotal: 17358.66 });
    expect(orderTax(14346, false, true)).toEqual({ withInvoice: false, taxTotal: 0, grandTotal: 14346 });
  });

  it('como monotributista (Factura C) nunca suma IVA: el precio de lista es el final', () => {
    expect(orderTax(14346, true, false)).toEqual({ withInvoice: true, taxTotal: 0, grandTotal: 14346 });
    expect(orderTax(14346, false, false)).toEqual({ withInvoice: false, taxTotal: 0, grandTotal: 14346 });
  });

  it('un pedido guardado conserva el IVA con el que se armó', () => {
    expect(storedTax({ total: '1000.0000', taxTotal: '210.0000', withInvoice: true })).toEqual({ withInvoice: true, taxTotal: 210, grandTotal: 1210 });
  });
});
