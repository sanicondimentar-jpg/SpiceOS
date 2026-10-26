'use client';

import { AlertTriangle, Boxes, TrendingUp, Users, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { money, number } from '@/lib/utils';
import { useExecutiveKpis, useMe, useRevenueByMonth } from '@/lib/hooks';

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data: k, isLoading } = useExecutiveKpis();
  const { data: months } = useRevenueByMonth();

  const delta = k && k.revenue_prev_mtd > 0 ? ((k.revenue_mtd - k.revenue_prev_mtd) / k.revenue_prev_mtd) * 100 : null;
  const max = Math.max(1, ...(months ?? []).map((m) => m.revenue));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hola{me ? `, ${me.user.fullName.split(' ')[0]}` : ''}</h1>
        <p className="text-sm text-muted-foreground">Así viene el mes. Abrí el copiloto con ⌘K para preguntar cualquier cosa.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi loading={isLoading} icon={TrendingUp} title="Facturación del mes" value={money(k?.revenue_mtd)}
          note={delta === null ? 'sin mes anterior' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs. mismo período`} tone={delta !== null && delta < 0 ? 'bad' : 'good'} />
        <Kpi loading={isLoading} icon={TrendingUp} title="Margen bruto del mes" value={money(k?.margin_mtd)}
          note={k && k.revenue_mtd > 0 ? `${((k.margin_mtd / k.revenue_mtd) * 100).toFixed(1)}% sobre ventas` : '—'} />
        <Kpi loading={isLoading} icon={Wallet} title="Deuda vencida" value={money(k?.overdue_total)} note="cuentas corrientes" tone={k && k.overdue_total > 0 ? 'bad' : undefined} />
        <Kpi loading={isLoading} icon={Users} title="Clientes activos (90 días)" value={number(k?.active_customers_90d)}
          note={`${number(k?.inactive_customers_60d)} sin comprar hace +60 días`} tone={k && k.inactive_customers_60d > 0 ? 'warn' : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Facturación por mes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-end gap-2" role="img" aria-label="Facturación de los últimos 12 meses">
              {(months ?? []).map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-primary/80" style={{ height: `${(m.revenue / max) * 100}%` }} title={`${m.month}: ${money(m.revenue)}`} />
                  <span className="text-[10px] text-muted-foreground">{m.month.slice(5)}</span>
                </div>
              ))}
              {!months?.length && <p className="m-auto text-sm text-muted-foreground">Todavía no hay ventas registradas.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alertas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Alert icon={Boxes} text={`${number(k?.stock_alerts)} productos bajo punto de pedido`} active={!!k?.stock_alerts} />
            <Alert icon={AlertTriangle} text={`${number(k?.expiring_lots_30d)} lotes vencen en 30 días`} active={!!k?.expiring_lots_30d} />
            <Alert icon={Users} text={`${number(k?.inactive_customers_60d)} clientes para reactivar`} active={!!k?.inactive_customers_60d} />
            <Alert icon={TrendingUp} text={`Embudo ponderado: ${money(k?.open_pipeline_weighted)}`} active={false} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi(props: { loading: boolean; icon: React.ElementType; title: string; value: string; note: string; tone?: 'good' | 'bad' | 'warn' }) {
  const Icon = props.icon;
  const tone = { good: 'text-success', bad: 'text-destructive', warn: 'text-warning' }[props.tone ?? 'good'];
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{props.title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {props.loading ? <Skeleton className="h-7 w-32" /> : <div className="text-2xl font-semibold tabular-nums">{props.value}</div>}
        <p className={`mt-1 text-xs ${props.tone ? tone : 'text-muted-foreground'}`}>{props.note}</p>
      </CardContent>
    </Card>
  );
}

function Alert({ icon: Icon, text, active }: { icon: React.ElementType; text: string; active: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className={`h-4 w-4 ${active ? 'text-warning' : 'text-muted-foreground'}`} />
      <span className={active ? '' : 'text-muted-foreground'}>{text}</span>
    </div>
  );
}
