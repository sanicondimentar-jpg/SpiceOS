import { round2 } from '../../shared/domain/money';

/** IVA general de los condimentos. Los precios de lista son sin IVA. */
export const VAT_RATE = 21;

/** IVA del pedido: solo si se factura. `net` es el total sin IVA (con descuentos). */
export function orderTax(net: number, withInvoice: boolean) {
  const taxTotal = withInvoice ? round2((net * VAT_RATE) / 100) : 0;
  return { withInvoice, taxTotal, grandTotal: round2(net + taxTotal) };
}
