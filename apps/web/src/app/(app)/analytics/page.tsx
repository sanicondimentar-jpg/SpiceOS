'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useInsights, type InsightTotals } from '@/lib/analytics';
import { cn, money, number } from '@/lib/utils';

type PresetKey = 'month' | 'lastMonth' | '90d' | 'year';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'month', label: 'Este mes' },
  { key: 'lastMonth', label: 'Mes pasado' },
  { key: '90d', label: 'Últimos 90 días' },
  { key: 'year', label: 'Este año' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function range(key: PresetKey): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'month':
      return { from: iso(new Date(y, m, 1)), to: iso(now) };
    case 'lastMonth':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case '90d':
      return { from: iso(new Date(y, m, now.getDate() - 89)), to: iso(now) };
    case 'year':
      return { from: iso(new Date(y, 0, 1)), to: iso(now) };
  }
}

/** "2026-11-05" → "5/11/2026" sin pasar por zona horaria. */
const day = (s: string | null | undefined) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const kg = (n: number) => `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(n)} kg`;
const pct = (part: number | undefined, whole: number) => (part === undefined || whole <= 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`);

export default function AnalyticsPage() {
  const [preset, setPreset] = useState<PresetKey>('month');
  const { from, to } = useMemo(() => range(preset), [preset]);
  const { data, isLoading, isError } = useInsights(from, to);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [showAllCustomers, setShowAllCustomers] = useState(false);

  const cost = !!data?.canSeeCost;
  const cur = data?.totals.current;
  const prev = data?.totals.previous;
  const maxMonth = Math.max(1, ...(data?.byMonth ?? []).map((m) => m.revenue));
  const products = data?.products ?? [];
  const customers = data?.customers ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inteligencia</h1>
          <p className="text-sm text-muted-foreground">
            Ventas de pedidos aprobados, sin IVA. {data && `Del ${day(data.period.from)} al ${day(data.period.to)}.`}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-1 rounded-lg border p-1" role="group" aria-label="Período">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreset(p.key)}
              aria-pressed={preset === p.key}
              className={cn('rounded-md px-3 py-1.5 text-sm', preset === p.key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isError && <p className="text-sm text-destructive">No se pudieron cargar los números. Probá de nuevo en un rato.</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi loading={isLoading} title="Ventas" value={money(cur?.revenue)} cur={cur} prev={prev} field="revenue" prevLabel={data && `(período anterior: ${day(data.previousPeriod.from)} al ${day(data.previousPeriod.to)})`} />
        {cost ? (
          <Kpi loading={isLoading} title="Margen bruto" value={money(cur?.margin)} cur={cur} prev={prev} field="margin" prevLabel={cur && `${pct(cur.margin, cur.revenue)} sobre ventas`} />
        ) : (
          <Kpi loading={isLoading} title="Kilos vendidos" value={kg(cur?.kg ?? 0)} cur={cur} prev={prev} field="kg" />
        )}
        <Kpi loading={isLoading} title="Pedidos" value={number(cur?.orders)} cur={cur} prev={prev} field="orders"
          prevLabel={cur && cur.orders > 0 ? `ticket promedio ${money(cur.revenue / cur.orders)}` : undefined} />
        <Kpi loading={isLoading} title="Clientes que compraron" value={number(cur?.customers)} cur={cur} prev={prev} field="customers"
          prevLabel={cost && cur ? `${kg(cur.kg)} vendidos` : undefined} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ventas por mes{cost ? ' y margen' : ''}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-48 items-end gap-2" role="img" aria-label="Ventas de los últimos 12 meses">
            {(data?.byMonth ?? []).map((m) => (
              <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <div className="relative w-full rounded-t bg-primary/30" style={{ height: `${(m.revenue / maxMonth) * 100}%` }}
                  title={`${MONTHS[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}: ${money(m.revenue)} en ${m.orders} pedidos${m.margin !== undefined ? `, margen ${money(m.margin)}` : ''}`}>
                  {m.margin !== undefined && (
                    <div className="absolute bottom-0 w-full rounded-t bg-primary" style={{ height: `${m.revenue > 0 ? Math.max(0, (m.margin / m.revenue) * 100) : 0}%` }} />
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">{MONTHS[Number(m.month.slice(5)) - 1]}</span>
              </div>
            ))}
            {data && !data.byMonth.length && <p className="m-auto text-sm text-muted-foreground">Todavía no hay ventas registradas.</p>}
            {isLoading && <Skeleton className="h-full w-full" />}
          </div>
          {cost && <p className="mt-2 text-xs text-muted-foreground">La parte oscura de cada barra es el margen.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <CardHeader>
            <CardTitle>Productos más vendidos</CardTitle>
          </CardHeader>
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Producto</th>
                <th className="px-4 py-2 text-right font-medium">Unidades</th>
                <th className="px-4 py-2 text-right font-medium">Ventas</th>
                {cost && <th className="px-4 py-2 text-right font-medium">Margen</th>}
                <th className="px-4 py-2 text-right font-medium">Clientes</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="p-4"><Skeleton className="h-24" /></td></tr>}
              {(showAllProducts ? products : products.slice(0, 10)).map((p) => (
                <tr key={p.variant_id} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                  </td>
                  <td className="px-4 py-2 text-right">{number(p.units)}</td>
                  <td className="px-4 py-2 text-right">{money(p.revenue)}</td>
                  {cost && <td className="px-4 py-2 text-right">{pct(p.margin, p.revenue)}</td>}
                  <td className="px-4 py-2 text-right">{number(p.customers)}</td>
                </tr>
              ))}
              {data && !products.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No hubo ventas en este período.</td></tr>}
            </tbody>
          </table>
          {products.length > 10 && (
            <button type="button" onClick={() => setShowAllProducts((v) => !v)} className="w-full border-t px-4 py-2 text-sm text-primary hover:underline">
              {showAllProducts ? 'Ver menos' : `Ver los ${products.length} productos`}
            </button>
          )}
        </Card>

        <Card className="overflow-x-auto">
          <CardHeader>
            <CardTitle>Mejores clientes</CardTitle>
          </CardHeader>
          <table className="w-full min-w-[480px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 text-right font-medium">Pedidos</th>
                <th className="px-4 py-2 text-right font-medium">Ventas</th>
                {cost && <th className="px-4 py-2 text-right font-medium">Margen</th>}
                <th className="px-4 py-2 text-right font-medium">Último</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="p-4"><Skeleton className="h-24" /></td></tr>}
              {(showAllCustomers ? customers : customers.slice(0, 10)).map((c) => (
                <tr key={c.customer_id} className="border-b last:border-0">
                  <td className="px-4 py-2"><Link href={`/customers/${c.customer_id}`} className="font-medium hover:underline">{c.name}</Link></td>
                  <td className="px-4 py-2 text-right">{number(c.orders)}</td>
                  <td className="px-4 py-2 text-right">{money(c.revenue)}</td>
                  {cost && <td className="px-4 py-2 text-right">{pct(c.margin, c.revenue)}</td>}
                  <td className="px-4 py-2 text-right">{day(c.last_order)}</td>
                </tr>
              ))}
              {data && !customers.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No hubo ventas en este período.</td></tr>}
            </tbody>
          </table>
          {customers.length > 10 && (
            <button type="button" onClick={() => setShowAllCustomers((v) => !v)} className="w-full border-t px-4 py-2 text-sm text-primary hover:underline">
              {showAllCustomers ? 'Ver menos' : `Ver los ${customers.length} clientes`}
            </button>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <CardHeader>
            <CardTitle>Clientes que dejaron de comprar</CardTitle>
            <p className="text-xs text-muted-foreground">Pasó bastante más tiempo del que suelen tardar entre pedido y pedido. Primero los que más compraban.</p>
          </CardHeader>
          <table className="w-full min-w-[480px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Compraba</th>
                <th className="px-4 py-2 text-right font-medium">Último pedido</th>
                <th className="px-4 py-2 text-right font-medium">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {(data?.lapsedCustomers ?? []).slice(0, 20).map((c) => (
                <tr key={c.customerId} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/customers/${c.customerId}`} className="font-medium hover:underline">{c.name}</Link>
                    {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{c.usualEveryDays ? `cada ~${c.usualEveryDays} días` : 'una sola vez'}</td>
                  <td className="px-4 py-2 text-right">
                    hace {c.daysSinceLastOrder} días
                    <div className="text-xs text-muted-foreground">{day(c.lastOrder)}</div>
                  </td>
                  <td className="px-4 py-2 text-right">{money(c.avgTicket)}</td>
                </tr>
              ))}
              {data && !data.lapsedCustomers.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Todos los clientes vienen comprando a su ritmo.</td></tr>}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-x-auto">
          <CardHeader>
            <CardTitle>Productos sin ventas en el período</CardTitle>
            <p className="text-xs text-muted-foreground">Tienen stock pero no se vendieron{cost ? '. Primero los que más plata tienen parada' : ''}.</p>
          </CardHeader>
          <table className="w-full min-w-[420px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Producto</th>
                <th className="px-4 py-2 text-right font-medium">Stock</th>
                {cost && <th className="px-4 py-2 text-right font-medium">Al costo</th>}
                <th className="px-4 py-2 text-right font-medium">Última venta</th>
              </tr>
            </thead>
            <tbody>
              {(data?.staleProducts ?? []).slice(0, 20).map((p) => (
                <tr key={p.variant_id} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                  </td>
                  <td className="px-4 py-2 text-right">{number(p.on_hand)}</td>
                  {cost && <td className="px-4 py-2 text-right">{money(p.stock_value)}</td>}
                  <td className="px-4 py-2 text-right">{p.last_sale ? day(p.last_sale) : <Badge>nunca</Badge>}</td>
                </tr>
              ))}
              {data && !data.staleProducts.length && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Todo lo que tiene stock se vendió en el período.</td></tr>}
            </tbody>
          </table>
          {(data?.staleProducts.length ?? 0) > 20 && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">Y {data!.staleProducts.length - 20} productos más.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi(props: {
  loading: boolean;
  title: string;
  value: string;
  cur?: InsightTotals;
  prev?: InsightTotals;
  field: keyof InsightTotals;
  prevLabel?: string;
}) {
  const c = props.cur?.[props.field];
  const p = props.prev?.[props.field];
  const delta = c !== undefined && p !== undefined && p > 0 ? ((c - p) / p) * 100 : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {props.loading ? (
          <Skeleton className="h-8 w-32" />
        ) : (
          <>
            <div className="text-2xl font-semibold">{props.value}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {delta !== null && (
                <span className={delta >= 0 ? 'text-success' : 'text-destructive'}>
                  {delta >= 0 ? '+' : ''}
                  {delta.toFixed(0)}% vs. período anterior
                </span>
              )}
              {props.prevLabel && <span>{props.prevLabel}</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
