'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { ArrowDown, ArrowUp, MapPin, Phone, Printer, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/hooks';
import {
  DAY_LABEL,
  ROUTE_STATUS_LABEL,
  ROUTE_STATUS_TONE,
  STOP_STATUS_LABEL,
  STOP_STATUS_TONE,
  useDeleteRoute,
  useRoute,
  useStartRoute,
  useStopDelivered,
  useStopFailed,
  useUpdateRoute,
  type RouteDetail,
} from '@/lib/logistics';
import { day } from '@/lib/sales';
import { money } from '@/lib/utils';

const FAIL_REASONS = ['Cerrado', 'No atendió', 'No tenía para pagar', 'Dirección equivocada'];

export default function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: r, isLoading } = useRoute(id);
  const { data: me } = useMe();
  const canWrite = !!me?.permissions.includes('orders.order.write');
  if (isLoading || !r) return <Skeleton className="mx-auto h-96 max-w-4xl" />;
  const total = r.stops.filter((s) => s.status !== 'DELIVERED').reduce((t, s) => t + s.order.grandTotal, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="print:hidden">
        <Link href="/logistics" className="text-sm text-muted-foreground hover:underline">← Logística</Link>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Hoja de ruta del {day(r.date)}</h1>
            <span className="print:hidden"><Badge tone={ROUTE_STATUS_TONE[r.status]}>{ROUTE_STATUS_LABEL[r.status]}</Badge></span>
          </div>
          <p className="text-sm text-muted-foreground">
            {r.driverName ? `Reparte ${r.driverName}` : 'Sin repartidor'} · {r.stops.length} paradas · {money(total)} a cobrar
          </p>
        </div>
        <Header route={r} canWrite={canWrite} />
      </div>
      <div className="space-y-3">
        {r.stops.map((s, i) => (
          <Stop key={s.deliveryId} route={r} index={i} canWrite={canWrite} />
        ))}
      </div>
      <div className="hidden pt-8 text-sm print:block">Firma del repartidor: ______________________</div>
    </div>
  );
}

function Header({ route, canWrite }: { route: RouteDetail; canWrite: boolean }) {
  const router = useRouter();
  const start = useStartRoute(route.id);
  const del = useDeleteRoute(route.id);
  const update = useUpdateRoute(route.id);
  const [editing, setEditing] = useState(false);
  const [driver, setDriver] = useState(route.driverName ?? '');
  const [date, setDate] = useState(route.date.slice(0, 10));
  const error = start.error?.message ?? del.error?.message ?? update.error?.message;
  const planned = route.status === 'PLANNED';
  return (
    <div className="ml-auto flex max-w-lg flex-col items-end gap-2 print:hidden">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir</Button>
        {planned && canWrite && (
          <>
            <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>Cambiar fecha o repartidor</Button>
            <Button variant="outline" size="sm" disabled={del.isPending} onClick={() => confirm('¿Borrar esta hoja? Los pedidos vuelven a "Para repartir".') && del.mutate(undefined, { onSuccess: () => router.push('/logistics') })}>
              Borrar hoja
            </Button>
          </>
        )}
        {route.status !== 'DONE' && route.stops.some((s) => s.status === 'SCHEDULED') && canWrite && (
          <Button size="sm" disabled={start.isPending} onClick={() => start.mutate(undefined)}>{start.isPending ? 'Despachando…' : 'Salir a repartir'}</Button>
        )}
      </div>
      {editing && (
        <form
          className="flex w-full flex-wrap justify-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ date, driverName: driver }, { onSuccess: () => setEditing(false) });
          }}
        >
          <Input type="date" aria-label="Fecha" className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input aria-label="Repartidor" placeholder="Repartidor" className="h-9 w-40" value={driver} onChange={(e) => setDriver(e.target.value)} />
          <Button type="submit" size="sm" className="h-9" disabled={update.isPending}>Guardar</Button>
        </form>
      )}
      {planned && <p className="text-right text-xs text-muted-foreground">Al salir, los pedidos pasan a despachados y se descuenta el stock. Tienen que estar listos.</p>}
      {error && <p className="text-right text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Stop({ route, index, canWrite }: { route: RouteDetail; index: number; canWrite: boolean }) {
  const s = route.stops[index]!;
  const o = s.order;
  const update = useUpdateRoute(route.id);
  const delivered = useStopDelivered();
  const failed = useStopFailed();
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');
  const planned = route.status === 'PLANNED';
  const ids = route.stops.map((x) => x.order.id);
  const move = (to: number) => {
    const next = [...ids];
    const [it] = next.splice(index, 1);
    next.splice(to, 0, it!);
    update.mutate({ orderIds: next });
  };
  const error = delivered.error?.message ?? failed.error?.message ?? update.error?.message;

  return (
    <Card className="break-inside-avoid">
      <CardContent className="space-y-2 p-4 text-sm">
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">{s.position}</span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{o.customer.name}</span>
              <Link href={`/orders/${o.id}`} className="font-mono text-xs text-muted-foreground hover:underline">{o.number}</Link>
              {!planned && <span className="print:hidden"><Badge tone={STOP_STATUS_TONE[s.status]}>{STOP_STATUS_LABEL[s.status]}</Badge></span>}
            </div>
            <div>{o.address ? `${o.address.street}, ${o.address.city}` : 'Sin dirección cargada'}</div>
            {o.address?.note && <div className="text-muted-foreground">{o.address.note}</div>}
            <div className="text-xs text-muted-foreground">
              {[
                o.customer.phone,
                o.customer.deliveryDays.length ? `recibe ${o.customer.deliveryDays.map((d) => DAY_LABEL[d] ?? d).join(', ')}` : null,
                o.customer.deliveryHours,
              ].filter(Boolean).join(' · ')}
            </div>
            {o.notes && <div className="text-xs">Notas: {o.notes}</div>}
            {s.status === 'FAILED' && s.notes && <div className="text-xs text-destructive">No se entregó: {s.notes}</div>}
          </div>
          <div className="text-right">
            <div className="font-semibold tabular-nums">{money(o.grandTotal)}</div>
            <div className="text-xs text-muted-foreground">a cobrar</div>
            <div className="hidden pt-2 text-xs print:block">Recibió: ________</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {o.mapsUrl && (
            <Button asChild variant="outline" size="sm"><a href={o.mapsUrl} target="_blank" rel="noreferrer"><MapPin className="h-4 w-4" /> Mapa</a></Button>
          )}
          {o.customer.phone && (
            <Button asChild variant="outline" size="sm"><a href={`tel:${o.customer.phone}`}><Phone className="h-4 w-4" /> Llamar</a></Button>
          )}
          {planned && canWrite && (
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="icon" aria-label="Subir" disabled={index === 0 || update.isPending} onClick={() => move(index - 1)}><ArrowUp className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" aria-label="Bajar" disabled={index === ids.length - 1 || update.isPending} onClick={() => move(index + 1)}><ArrowDown className="h-4 w-4" /></Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Sacar de la hoja"
                disabled={ids.length === 1 || update.isPending}
                onClick={() => update.mutate({ orderIds: ids.filter((x) => x !== o.id) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
          {canWrite && (s.status === 'IN_TRANSIT' || (s.status === 'FAILED' && route.status !== 'PLANNED')) && (
            <div className="ml-auto flex gap-2">
              {s.status === 'IN_TRANSIT' && !failing && <Button variant="outline" size="sm" onClick={() => setFailing(true)}>No se pudo</Button>}
              <Button size="sm" disabled={delivered.isPending} onClick={() => delivered.mutate(s.deliveryId)}>Entregado</Button>
            </div>
          )}
        </div>
        {failing && (
          <div className="space-y-2 print:hidden">
            <div className="flex flex-wrap gap-2">
              {FAIL_REASONS.map((x) => (
                <Button key={x} type="button" variant="outline" size="sm" className={reason === x ? 'border-primary text-primary' : ''} onClick={() => setReason(x)}>{x}</Button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                failed.mutate({ deliveryId: s.deliveryId, reason: reason.trim() }, { onSuccess: () => setFailing(false) });
              }}
            >
              <Input autoFocus aria-label="Motivo" placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button type="submit" variant="destructive" size="sm" className="h-9" disabled={!reason.trim() || failed.isPending}>Guardar</Button>
              <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setFailing(false)}>Volver</Button>
            </form>
            <p className="text-xs text-muted-foreground">El pedido vuelve a &quot;Para repartir&quot; para la próxima hoja.</p>
          </div>
        )}
        {error && <p className="text-sm text-destructive print:hidden">{error}</p>}
      </CardContent>
    </Card>
  );
}
