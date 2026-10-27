import { orderTax } from './order-tax';

describe('orderTax', () => {
  it('suma 21 % de IVA solo cuando el pedido se factura', () => {
    expect(orderTax(14346, true)).toEqual({ withInvoice: true, taxTotal: 3012.66, grandTotal: 17358.66 });
    expect(orderTax(14346, false)).toEqual({ withInvoice: false, taxTotal: 0, grandTotal: 14346 });
  });
});
