'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/hooks';
import {
  DAY_LABEL,
  ROUTE_STATUS_LABEL,
  ROUTE_STATUS_TONE,
  useCreateRoute,
  usePendingDeliveries,
  useRoutes,
  type PendingDelivery,
} from '@/lib/logistics';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/orders';
import { day } from '@/lib/sales';
import { money } from '@/lib/utils';

const pad = (n: number) => String(n).padStart(2, '0');
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function LogisticsPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const canWrite = !!me?.permissions.includes('orders.order.write');
  const { data: pending, isLoading } = usePendingDeliveries();
  const { data: routes } = useRoutes();
  const create = useCreateRoute();
  const [picked, setPicked] = useState<string[]>([]);
  const [date, setDate] = useState(() => isoLocal(new Date()));
  const [driver, setDriver] = useState('');

  const zones = useMemo(() => {
    const m = new Map<string, PendingDelivery[]>();
    for (const o of pending ?? []) m.set(o.zone, [...(m.get(o.zone) ?? []), o]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [pending]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleZone = (list: PendingDelivery[]) => {
    const ids = list.map((o) => o.id);
    const all = ids.every((id) => picked.includes(id));
    setPicked((p) => (all ? p.filter((x) => !ids.includes(x)) : [...p, ...ids.filter((id) => !p.includes(id))]));
  };
  const total = (pending ?? []).filter((o) => picked.includes(o.id)).reduce((s, o) => s + o.grandTotal, 0);
  const active = (routes ?? []).filter((r) => r.status !== 'DONE');
  const done = (routes ?? []).filter((r) => r.status === 'DONE').slice(0, 15);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Logística</h1>
        <p className="text-sm text-muted-foreground">
          Elegí los pedidos a repartir, armá la hoja de ruta y marcá cada entrega desde el celular. Al salir a repartir los pedidos pasan a despachados y se descuenta el stock.
        </p>
      </div>

      {!!active.length && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((r) => (
            <Link key={r.id} href={`/logistics/routes/${r.id}`}>
              <Card className="transition hover:border-primary">
                <CardContent className="space-y-1 p-4 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Hoja del {day(r.date)}</span>
                    <Badge tone={ROUTE_STATUS_TONE[r.status]}>{ROUTE_STATUS_LABEL[r.status]}</Badge>
                  </div>
                  <div className="text-muted-foreground">
                    {r.driverName ?? 'Sin repartidor'} · {r.stops} paradas{r.status === 'IN_PROGRESS' && ` · ${r.delivered + r.failed} de ${r.stops} hechas`}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <h2 className="text-lg font-semibold">Para repartir</h2>
          {isLoading && <Skeleton className="h-40" />}
          {pending && !pending.length && (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No hay pedidos esperando reparto.</CardContent></Card>
          )}
          {zones.map(([zone, list]) => (
            <Card key={zone} className="overflow-hidden">
              <CardHeader className="flex-row items-center gap-3 py-3">
                {canWrite && (
                  <input
                    type="checkbox"
                    aria-label={`Elegir todos los de ${zone}`}
                    className="h-4 w-4"
                    checked={list.every((o) => picked.includes(o.id))}
                    onChange={() => toggleZone(list)}
                  />
                )}
                <CardTitle>{zone}</CardTitle>
                <span className="text-xs text-muted-foreground">{list.length} pedidos</span>
              </CardHeader>
              <ul className="divide-y border-t">
                {list.map((o) => (
                  <li key={o.id}>
                    <label className="flex cursor-pointer gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                      {canWrite && <input type="checkbox" className="mt-1 h-4 w-4" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} />}
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{o.customer.name}</span>
                          <Link href={`/orders/${o.id}`} className="font-mono text-xs text-muted-foreground hover:underline" onClick={(e) => e.stopPropagation()}>{o.number}</Link>
                          <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                          {o.lastFailure && <Badge tone="bad">No se entregó: {o.lastFailure}</Badge>}
                        </div>
                        <div className="text-muted-foreground">{o.address ? `${o.address.street}, ${o.address.city}` : 'Sin dirección cargada'}</div>
                        <div className="text-xs text-muted-foreground">
                          {[
                            o.customer.deliveryDays.length ? `Recibe ${o.customer.deliveryDays.map((d) => DAY_LABEL[d] ?? d).join(', ')}` : null,
                            o.customer.deliveryHours,
                            o.requestedDate ? `pidió para el ${day(o.requestedDate)}` : null,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="text-right tabular-nums">{money(o.grandTotal)}</div>
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>

        {canWrite && (
          <Card className="w-full lg:sticky lg:top-4 lg:w-80">
            <CardHeader><CardTitle>Nueva hoja de ruta</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Field label="Fecha" htmlFor="route-date">
                <Input id="route-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Repartidor" htmlFor="route-driver">
                <Input id="route-driver" placeholder="Quién reparte" value={driver} onChange={(e) => setDriver(e.target.value)} />
              </Field>
              <p className="text-muted-foreground">
                {picked.length ? `${picked.length} pedidos · ${money(total)} a cobrar` : 'Elegí pedidos de la lista.'}
              </p>
              {create.error && <p className="text-destructive">{create.error.message}</p>}
              <Button
                className="w-full"
                disabled={!picked.length || !date || create.isPending}
                onClick={() =>
                  create.mutate(
                    { date, driverName: driver.trim() || undefined, orderIds: picked },
                    { onSuccess: ({ id }) => { setPicked([]); router.push(`/logistics/routes/${id}`); } },
                  )
                }
              >
                Armar hoja de ruta
              </Button>
              <p className="text-xs text-muted-foreground">Después podés ordenar las paradas e imprimirla.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {!!done.length && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Hojas terminadas</h2>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <tbody>
                {done.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5"><Link href={`/logistics/routes/${r.id}`} className="font-medium hover:underline">Hoja del {day(r.date)}</Link></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{r.driverName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">{r.delivered} entregados{r.failed ? ` · ${r.failed} sin entregar` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
