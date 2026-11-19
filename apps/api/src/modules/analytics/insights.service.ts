import { BadRequestException, Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@spiceos/contracts';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { lapsedCustomers, type CustomerRhythm } from './lapsed';

/**
 * Pantalla Inteligencia: ventas, margen, productos y clientes de un período.
 * Cuenta como venta todo pedido aprobado (no borradores, ni pedidos web por revisar, ni cancelados).
 * Las fechas se toman en hora de Argentina; los importes son netos (sin IVA), igual que el tablero de Inicio.
 */
const TZ = 'America/Argentina/Buenos_Aires';
const SOLD = ['CONFIRMED', 'PICKING', 'READY', 'DISPATCHED', 'DELIVERED', 'INVOICED'];

export interface Period {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
}

export interface Totals {
  revenue: number;
  margin: number;
  orders: number;
  customers: number;
  kg: number;
}

@Injectable()
export class InsightsService {
  constructor(private readonly uow: UnitOfWork) {}

  async insights(period: Period) {
    const { from, to } = validPeriod(period);
    const prev = previousPeriod(from, to);
    const canSeeCost = RequestContextStore.get().permissions.has(PERMISSIONS.catalog.costRead);

    const data = await this.uow.read(async (tx) => {
      const totals = (f: string, t: string) =>
        tx.$queryRaw<Totals[]>`
          WITH o AS (
            SELECT * FROM sales_orders
            WHERE status::text = ANY(${SOLD})
              AND (coalesce(confirmed_at, created_at) AT TIME ZONE ${TZ})::date BETWEEN ${f}::date AND ${t}::date
          )
          SELECT coalesce(sum(o.total),0)::float AS revenue,
                 coalesce(sum(o.margin_total),0)::float AS margin,
                 count(*)::int AS orders,
                 count(DISTINCT o.customer_id)::int AS customers,
                 coalesce((SELECT sum(l.quantity * coalesce(v.net_weight_kg, 0))
                           FROM sales_order_lines l JOIN product_variants v ON v.id = l.variant_id
                           WHERE l.order_id IN (SELECT id FROM o)), 0)::float AS kg
          FROM o`;

      const [current] = await totals(from, to);
      const [previous] = await totals(prev.from, prev.to);

      const byMonth = await tx.$queryRaw<{ month: string; revenue: number; margin: number; orders: number }[]>`
        SELECT to_char(date_trunc('month', coalesce(confirmed_at, created_at) AT TIME ZONE ${TZ}), 'YYYY-MM') AS month,
               sum(total)::float AS revenue, sum(margin_total)::float AS margin, count(*)::int AS orders
        FROM sales_orders
        WHERE status::text = ANY(${SOLD})
          AND (coalesce(confirmed_at, created_at) AT TIME ZONE ${TZ})::date >= (date_trunc('month', ${to}::date) - interval '11 months')::date
          AND (coalesce(confirmed_at, created_at) AT TIME ZONE ${TZ})::date <= ${to}::date
        GROUP BY 1 ORDER BY 1`;

      const products = await tx.$queryRaw<
        { variant_id: string; sku: string; name: string; units: number; kg: number; revenue: number; margin: number; orders: number; customers: number }[]
      >`
        SELECT v.id AS variant_id, v.sku, (p.name || ' ' || v.name) AS name,
               sum(l.quantity)::float AS units,
               sum(l.quantity * coalesce(v.net_weight_kg, 0))::float AS kg,
               sum(l.line_total)::float AS revenue,
               sum(l.line_total - l.quantity * l.unit_cost)::float AS margin,
               count(DISTINCT o.id)::int AS orders,
               count(DISTINCT o.customer_id)::int AS customers
        FROM sales_order_lines l
        JOIN sales_orders o ON o.id = l.order_id
        JOIN product_variants v ON v.id = l.variant_id
        JOIN products p ON p.id = v.product_id
        WHERE o.status::text = ANY(${SOLD})
          AND (coalesce(o.confirmed_at, o.created_at) AT TIME ZONE ${TZ})::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY v.id, v.sku, p.name, v.name
        ORDER BY revenue DESC`;

      // Productos activos con stock que no se vendieron en el período.
      const stale = await tx.$queryRaw<{ variant_id: string; sku: string; name: string; on_hand: number; stock_value: number; last_sale: string | null }[]>`
        SELECT v.id AS variant_id, v.sku, (p.name || ' ' || v.name) AS name,
               s.on_hand::float, (s.on_hand * v.current_cost)::float AS stock_value,
               to_char((SELECT max(coalesce(o.confirmed_at, o.created_at) AT TIME ZONE ${TZ})
                        FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
                        WHERE l.variant_id = v.id AND o.status::text = ANY(${SOLD})), 'YYYY-MM-DD') AS last_sale
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        JOIN LATERAL (SELECT coalesce(sum(on_hand), 0) AS on_hand FROM stock_items WHERE variant_id = v.id) s ON true
        WHERE v.is_active AND p.is_active AND p.deleted_at IS NULL AND s.on_hand > 0
          AND NOT EXISTS (
            SELECT 1 FROM sales_order_lines l JOIN sales_orders o ON o.id = l.order_id
            WHERE l.variant_id = v.id AND o.status::text = ANY(${SOLD})
              AND (coalesce(o.confirmed_at, o.created_at) AT TIME ZONE ${TZ})::date BETWEEN ${from}::date AND ${to}::date)
        ORDER BY stock_value DESC`;

      const customers = await tx.$queryRaw<
        { customer_id: string; name: string; orders: number; revenue: number; margin: number; last_order: string }[]
      >`
        SELECT c.id AS customer_id, coalesce(c.trade_name, c.legal_name) AS name,
               count(*)::int AS orders, sum(o.total)::float AS revenue, sum(o.margin_total)::float AS margin,
               to_char(max(coalesce(o.confirmed_at, o.created_at) AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS last_order
        FROM sales_orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.status::text = ANY(${SOLD})
          AND (coalesce(o.confirmed_at, o.created_at) AT TIME ZONE ${TZ})::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY c.id
        ORDER BY revenue DESC`;

      // Ritmo de compra de cada cliente en toda su historia, para ver quién dejó de comprar.
      const rhythm = await tx.$queryRaw<CustomerRhythm[]>`
        SELECT c.id AS customer_id, coalesce(c.trade_name, c.legal_name) AS name, c.phone,
               count(*)::int AS orders,
               to_char(min(coalesce(o.confirmed_at, o.created_at) AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS first_order,
               to_char(max(coalesce(o.confirmed_at, o.created_at) AT TIME ZONE ${TZ}), 'YYYY-MM-DD') AS last_order,
               (sum(o.total) / count(*))::float AS avg_ticket
        FROM sales_orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.status::text = ANY(${SOLD}) AND c.deleted_at IS NULL
        GROUP BY c.id`;

      return { current, previous, byMonth, products, stale, customers, rhythm };
    });

    const today = todayInArgentina();
    const hideCost = <T extends { margin?: number; stock_value?: number }>(r: T) => {
      if (canSeeCost) return r;
      const { margin: _m, stock_value: _s, ...rest } = r;
      return rest;
    };

    return {
      period: { from, to },
      previousPeriod: prev,
      canSeeCost,
      totals: {
        current: hideCost(data.current ?? emptyTotals()),
        previous: hideCost(data.previous ?? emptyTotals()),
      },
      byMonth: data.byMonth.map(hideCost),
      products: data.products.map(hideCost),
      staleProducts: data.stale.map(hideCost),
      customers: data.customers.map(hideCost),
      lapsedCustomers: lapsedCustomers(data.rhythm, today),
    };
  }
}

function emptyTotals(): Totals {
  return { revenue: 0, margin: 0, orders: 0, customers: 0, kg: 0 };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validPeriod({ from, to }: Partial<Period>): Period {
  if (!from || !to || !DATE.test(from) || !DATE.test(to)) throw new BadRequestException('Elegí un período (desde y hasta, AAAA-MM-DD).');
  if (from > to) throw new BadRequestException('La fecha "desde" es posterior a "hasta".');
  return { from, to };
}

/** El período anterior de igual largo, que termina el día antes de `from`. */
export function previousPeriod(from: string, to: string): Period {
  const day = 86_400_000;
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  const len = Math.round((t - f) / day) + 1;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(f - len * day), to: iso(f - day) };
}

export function todayInArgentina(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}
