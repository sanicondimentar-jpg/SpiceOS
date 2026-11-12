import { round2 } from '../../shared/domain/money';

/** IVA general de los condimentos (como Responsable Inscripto los precios de lista son sin IVA). */
export const VAT_RATE = 21;

/**
 * IVA del pedido. `net` es el total con descuentos a precios de lista.
 * Monotributo (Factura C): el precio de lista es el final, nunca se suma IVA.
 * Responsable Inscripto: se suma 21 % solo si el pedido va con factura.
 */
export function orderTax(net: number, withInvoice: boolean, addsVat: boolean) {
  const taxTotal = withInvoice && addsVat ? round2((net * VAT_RATE) / 100) : 0;
  return { withInvoice, taxTotal, grandTotal: round2(net + taxTotal) };
}

/** Totales de un pedido ya guardado: usa el IVA que quedó calculado al armarlo. */
export function storedTax(o: { total: unknown; taxTotal: unknown; withInvoice: boolean }) {
  const taxTotal = Number(o.taxTotal);
  return { withInvoice: o.withInvoice, taxTotal, grandTotal: round2(Number(o.total) + taxTotal) };
}
