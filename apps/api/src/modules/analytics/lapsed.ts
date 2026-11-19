export interface CustomerRhythm {
  customer_id: string;
  name: string;
  phone: string | null;
  orders: number;
  first_order: string; // YYYY-MM-DD
  last_order: string; // YYYY-MM-DD
  avg_ticket: number;
}

export interface LapsedCustomer {
  customerId: string;
  name: string;
  phone: string | null;
  orders: number;
  lastOrder: string;
  daysSinceLastOrder: number;
  usualEveryDays: number | null; // cada cuántos días compraba (null si compró una sola vez)
  avgTicket: number;
}

/** Un cliente con una sola compra se considera perdido a los 45 días; nunca antes de 21. */
const SINGLE_ORDER_DAYS = 45;
const MIN_DAYS = 21;

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Clientes que dejaron de comprar: pasó bastante más de lo que solían tardar entre pedido y pedido
 * (una vez y media su ritmo habitual). Primero los que más compraban.
 */
export function lapsedCustomers(rows: CustomerRhythm[], today: string): LapsedCustomer[] {
  return rows
    .map((r) => {
      const since = daysBetween(r.last_order, today);
      const usual = r.orders > 1 ? Math.max(1, Math.round(daysBetween(r.first_order, r.last_order) / (r.orders - 1))) : null;
      const threshold = usual === null ? SINGLE_ORDER_DAYS : Math.max(MIN_DAYS, Math.round(usual * 1.5));
      return {
        lapsed: since >= threshold,
        value: r.avg_ticket * r.orders,
        row: {
          customerId: r.customer_id,
          name: r.name,
          phone: r.phone,
          orders: r.orders,
          lastOrder: r.last_order,
          daysSinceLastOrder: since,
          usualEveryDays: usual,
          avgTicket: Math.round(r.avg_ticket),
        },
      };
    })
    .filter((x) => x.lapsed)
    .sort((a, b) => b.value - a.value)
    .map((x) => x.row);
}
