'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, PackageSearch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CHANNEL_LABEL, NEXT_ACTION, STATUS_LABEL, useOrderBoard, useOrderTransition, type BoardOrder, type OrderStatus } from '@/lib/orders';
import { cn, date, money } from '@/lib/utils';

/** Etapas del pedido, de izquierda a derecha. Al marcarse entregado sale del tablero. */
const STAGES: { title: string; statuses: OrderStatus[]; empty: string }[] = [
  { title: 'Por confirmar', statuses: ['PENDING_REVIEW', 'DRAFT'], empty: 'No hay pedidos nuevos.' },
  { title: 'Confirmados', statuses: ['CONFIRMED'], empty: 'Nada para preparar.' },
  { title: 'En preparación', statuses: ['PICKING'], empty: 'Nada en preparación.' },
  { title: 'Listos para salir', statuses: ['READY'], empty: 'Nada esperando despacho.' },
  { title: 'En camino', statuses: ['DISPATCHED'], empty: 'Nada en reparto.' },
];

/** Pasos que no tienen vuelta atrás: piden una segunda confirmación. */
const CONFIRM_TWICE: OrderStatus[] = ['READY', 'DISPATCHED'];

export function OrderBoard({ canWrite }: { canWrite: boolean }) {
  const { data, isLoading, isError } = useOrderBoard();
  const orders = data ?? [];
  const toCollect = orders.reduce((s, o) => s + o.grandTotal, 0);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <CardTitle>Pedidos en curso</CardTitle>
        {!isLoading && !isError && (
          <span className="text-xs text-muted-foreground">
            {orders.length === 1 ? '1 pedido' : `${orders.length} pedidos`} · {money(toCollect)} a cobrar
          </span>
        )}
        <Link href="/orders" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Ver todos, incluidos los entregados <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {isError && <p className="text-sm text-destructive">No se pudieron cargar los pedidos. Se vuelve a intentar solo en unos segundos.</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {STAGES.map((stage) => {
            const items = orders.filter((o) => stage.statuses.includes(o.status));
            return (
              <section key={stage.title} aria-label={stage.title} className="flex min-w-0 flex-col rounded-lg bg-muted/50 p-2">
                <h3 className="flex items-center justify-between px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {stage.title}
                  <span className={cn('rounded-full px-1.5 tabular-nums', items.length ? 'bg-primary/15 text-primary' : '')}>{isLoading ? '…' : items.length}</span>
                </h3>
                <div className="flex max-h-[26rem] flex-col gap-2 overflow-y-auto">
                  {isLoading && <Skeleton className="h-24 w-full" />}
                  {!isLoading && !items.length && <p className="px-1 py-3 text-xs text-muted-foreground">{stage.empty}</p>}
                  {items.map((o) => <OrderCard key={o.id} order={o} canWrite={canWrite} />)}
                </div>
              </section>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function OrderCard({ order: o, canWrite }: { order: BoardOrder; canWrite: boolean }) {
  const transition = useOrderTransition(o.id);
  const [sure, setSure] = useState(false);
  const next = NEXT_ACTION[o.status];
  const late = o.requestedDate && o.requestedDate.slice(0, 10) < today();
  const review = o.status === 'PENDING_REVIEW' || o.status === 'DRAFT';

  const advance = () => {
    if (!next) return;
    if (next.to === 'DISPATCHED' && o.overdueDebt > 0 && !confirm(`${o.customer} tiene ${money(o.overdueDebt)} vencidos: no se entrega hasta que regularice. ¿Despachar igual?`)) return;
    if (CONFIRM_TWICE.includes(o.status) && !sure) return setSure(true);
    transition.mutate({ to: next.to }, { onSettled: () => setSure(false) });
  };

  return (
    <article className="rounded-md border bg-card p-2.5 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <Link href={`/orders/${o.id}`} className="font-mono text-xs font-medium hover:underline">{o.number}</Link>
        <span className="ml-auto text-[11px] text-muted-foreground">{CHANNEL_LABEL[o.channel] ?? o.channel}</span>
      </div>
      <Link href={`/customers/${o.customerId}`} className="mt-0.5 block truncate font-medium hover:underline" title={o.customer}>{o.customer}</Link>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{money(o.grandTotal)}</span>
        <span title={`En este estado desde ${new Date(o.statusSince).toLocaleString('es-AR')}`}>{ago(o.statusSince)}</span>
      </div>
      {(o.status === 'DRAFT' || o.waitingStock || o.requestedDate || o.overdueDebt > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {o.status === 'DRAFT' && <Badge>{STATUS_LABEL.DRAFT}</Badge>}
          {o.overdueDebt > 0 && <Badge tone="bad" title="No se entrega hasta que regularice">Deuda vencida {money(o.overdueDebt)}</Badge>}
          {o.waitingStock && <Badge tone="warn"><PackageSearch className="mr-1 h-3 w-3" />Espera mercadería</Badge>}
          {o.requestedDate && <Badge tone={late ? 'bad' : 'neutral'}>{late ? 'Atrasado · ' : 'Entrega '}{date(o.requestedDate)}</Badge>}
        </div>
      )}
      {review && (
        <Button asChild size="sm" variant="outline" className="mt-2 h-7 w-full text-xs">
          <Link href={`/orders/${o.id}`}>{o.status === 'PENDING_REVIEW' ? 'Revisar y aprobar' : 'Abrir para confirmar'}</Link>
        </Button>
      )}
      {next && canWrite && (
        <Button size="sm" variant={sure ? 'default' : 'outline'} className="mt-2 h-7 w-full text-xs" disabled={transition.isPending} onClick={advance}>
          {transition.isPending ? 'Guardando…' : sure ? `¿Seguro? ${next.label}` : next.label}
        </Button>
      )}
      {transition.error && <p className="mt-1 text-xs text-destructive">{transition.error.message}</p>}
    </article>
  );
}

const today = () => new Date().toLocaleDateString('en-CA');

/** "hace 5 min", "hace 3 h", "hace 2 días": cuánto lleva en esta etapa. */
function ago(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}
