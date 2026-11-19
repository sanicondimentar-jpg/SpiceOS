'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { CUSTOMER_PAYMENT_METHOD_LABEL, day, today, useCollections, useRunReminders } from '@/lib/collections';
import { useMe } from '@/lib/hooks';
import { cn, money } from '@/lib/utils';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function periods() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const firstPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastPrev = new Date(now.getFullYear(), now.getMonth(), 0);
  return [
    { key: 'today', label: 'Hoy', from: today(), to: today() },
    { key: 'week', label: 'Esta semana', from: iso(monday), to: today() },
    { key: 'month', label: 'Este mes', from: `${today().slice(0, 8)}01`, to: today() },
    { key: 'prev', label: 'Mes anterior', from: iso(firstPrev), to: iso(lastPrev) },
  ];
}

/** Cobranza: lo cobrado en efectivo y en cuenta, y lo que deben los clientes. */
export default function ReceivablesPage() {
  const options = periods();
  const [range, setRange] = useState({ from: options[2]!.from, to: options[2]!.to });
  const { data, isLoading, error } = useCollections(range.from, range.to);
  const { data: me } = useMe();
  const canWrite = !!me?.permissions.includes('receivables.payment.write');
  const run = useRunReminders();
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Cobranza</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          {canWrite && (
            <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
              {run.isPending ? 'Mandando…' : 'Mandar avisos de hoy'}
            </Button>
          )}
          {me?.permissions.includes('core.settings.manage') && (
            <Link href="/settings/collections"><Button size="sm" variant="ghost">Plazo y avisos</Button></Link>
          )}
        </div>
      </div>
      {run.data && (
        <p className="text-sm text-muted-foreground">
          {run.data.sent || run.data.failed ? `Avisos: ${run.data.sent} enviados${run.data.failed ? `, ${run.data.failed} con error (ver en la cuenta del cliente)` : ''}.` : 'No había avisos para mandar hoy.'}
          {run.data.pending.map((p) => <span key={p} className="block text-warning">{p}</span>)}
        </p>
      )}
      {run.error && <p className="text-sm text-destructive">{run.error.message}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {options.map((o) => (
          <Button
            key={o.key}
            size="sm"
            variant="outline"
            className={cn(range.from === o.from && range.to === o.to && 'border-primary text-primary')}
            onClick={() => setRange({ from: o.from, to: o.to })}
          >
            {o.label}
          </Button>
        ))}
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Input type="date" aria-label="Desde" className="h-8 w-40" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
          a
          <Input type="date" aria-label="Hasta" className="h-8 w-40" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {isLoading && <Skeleton className="h-28 w-full" />}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Dinero en efectivo" value={money(data.collected.cash)} hint="Cobrado en el período" big />
            <Stat label="Dinero en cuenta" value={money(data.collected.account)} hint="Transferencias, Mercado Pago y cheques del período" big />
            <Stat label="Total cobrado" value={money(data.collected.total)} hint={`Del ${day(data.from)} al ${day(data.to)}`} big />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="A cobrar" value={money(data.receivable)} hint="Todo lo que deben los clientes hoy" />
            <Stat label="Vencido" value={money(data.overdue)} tone={data.overdue > 0.005 ? 'bad' : undefined} hint="Pasó el plazo: no se entregan pedidos nuevos hasta regularizar" />
            <Stat label={`Vence en los próximos ${data.daysBefore} días`} value={money(data.dueSoon)} tone={data.dueSoon > 0.005 ? 'warn' : undefined} />
          </div>

          <Card className="overflow-x-auto">
            <div className="p-4"><h2 className="font-semibold">Clientes con saldo</h2></div>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-y text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 text-right font-medium">Debe</th>
                  <th className="px-4 py-2 text-right font-medium">Vencido</th>
                  <th className="px-4 py-2 font-medium">Próximo vencimiento</th>
                  <th className="px-4 py-2 font-medium">Último cobro</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Nadie debe nada. Los pedidos entregados sin cobrar aparecen acá solos.</td></tr>
                )}
                {data.customers.map((c) => (
                  <tr key={c.customerId} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/receivables/${c.customerId}`} className="font-medium hover:underline">{c.name}</Link>
                      {c.overdue > 0.005 && <Badge tone="bad" className="ml-2">Vencida hace {c.maxDaysOverdue} {c.maxDaysOverdue === 1 ? 'día' : 'días'}</Badge>}
                      {c.overdue <= 0.005 && c.dueSoon > 0.005 && <Badge tone="warn" className="ml-2">Vence pronto</Badge>}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right font-medium tabular-nums', c.balance < -0.005 && 'text-success')}>
                      {c.balance < -0.005 ? `${money(-c.balance)} a favor` : money(c.balance)}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', c.overdue > 0.005 && 'font-medium text-destructive')}>{c.overdue > 0.005 ? money(c.overdue) : '—'}</td>
                    <td className="px-4 py-2.5">{day(c.oldestDueDate)}</td>
                    <td className="px-4 py-2.5">{day(c.lastPaymentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="overflow-x-auto">
            <div className="flex items-center p-4">
              <h2 className="font-semibold">Cobros del período</h2>
              <span className="ml-auto text-sm text-muted-foreground">{data.payments.length} {data.payments.length === 1 ? 'cobro' : 'cobros'}</span>
            </div>
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-y text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 font-medium">Dinero</th>
                  <th className="px-4 py-2 font-medium">Medio</th>
                  <th className="px-4 py-2 text-right font-medium">Monto</th>
                  <th className="px-4 py-2 font-medium">Cobró</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No hay cobros en estas fechas.</td></tr>}
                {(showAll ? data.payments : data.payments.slice(0, 50)).map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{day(p.date)}</td>
                    <td className="px-4 py-2"><Link href={`/receivables/${p.customerId}`} className="hover:underline">{p.customer}</Link></td>
                    <td className="px-4 py-2"><Badge tone={p.bucket === 'CASH' ? 'good' : 'brand'}>{p.bucket === 'CASH' ? 'Efectivo' : 'En cuenta'}</Badge></td>
                    <td className="px-4 py-2">
                      {CUSTOMER_PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                      {p.reference && <span className="text-xs text-muted-foreground"> · op. {p.reference}</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{money(p.amount)}</td>
                    <td className="px-4 py-2 text-xs">{p.collectedBy ?? p.createdBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!showAll && data.payments.length > 50 && (
              <div className="p-3 text-center"><Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>Ver los {data.payments.length}</Button></div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone, hint, big }: { label: string; value: string; tone?: 'warn' | 'bad'; hint?: string; big?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn('font-semibold tabular-nums', big ? 'text-2xl' : 'text-xl', tone === 'warn' && 'text-warning', tone === 'bad' && 'text-destructive')}>{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
