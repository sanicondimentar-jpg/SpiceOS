'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, use, useState } from 'react';
import { Printer } from 'lucide-react';
import { OrderForm } from '@/components/orders/order-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/hooks';
import {
  CHANNEL_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  useConfirmOrder,
  useOrder,
  useOrderTransition,
  useUpdateOrder,
  type OrderDetail,
  type OrderStatus,
} from '@/lib/orders';
import { cn, date, money, number } from '@/lib/utils';

/** Acción principal de cada estado: qué botón mueve el pedido al siguiente. */
const NEXT_ACTION: Partial<Record<OrderStatus, { to: 'PICKING' | 'READY' | 'DISPATCHED' | 'DELIVERED'; label: string }>> = {
  CONFIRMED: { to: 'PICKING', label: 'Empezar preparación' },
  PICKING: { to: 'READY', label: 'Marcar listo' },
  READY: { to: 'DISPATCHED', label: 'Despachar' },
  DISPATCHED: { to: 'DELIVERED', label: 'Marcar entregado' },
};

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <Order id={id} />
    </Suspense>
  );
}

function Order({ id }: { id: string }) {
  const { data: o, isLoading } = useOrder(id);
  const { data: me } = useMe();
  const initialError = useSearchParams().get('error');
  const [editing, setEditing] = useState(false);
  const can = (p: string) => !!me?.permissions.includes(p);
  if (isLoading || !o) return <Skeleton className="mx-auto h-96 max-w-6xl" />;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="print:hidden">
        <Link href="/orders" className="text-sm text-muted-foreground hover:underline">← Pedidos</Link>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Pedido {o.number}</h1>
            <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            <Link href={`/customers/${o.customer.id}`} className="font-medium text-foreground hover:underline">{o.customer.tradeName ?? o.customer.legalName}</Link>
            {o.customer.taxId && ` · CUIT ${o.customer.taxId}`} · {o.warehouse.name} · {CHANNEL_LABEL[o.channel] ?? o.channel} · {date(o.createdAt)}
            {o.requestedDate && ` · entrega ${date(o.requestedDate)}`}
          </p>
        </div>
        {!editing && <Actions order={o} can={can} onEdit={() => setEditing(true)} initialError={initialError} />}
      </div>

      {editing ? (
        <EditDraft order={o} onDone={() => setEditing(false)} />
      ) : (
        <>
          {o.notes && <Card><CardContent className="p-4 text-sm"><span className="text-muted-foreground">Notas: </span>{o.notes}</CardContent></Card>}
          <Lines order={o} />
          <History order={o} />
        </>
      )}
    </div>
  );
}

function Actions({ order, can, onEdit, initialError }: { order: OrderDetail; can: (p: string) => boolean; onEdit: () => void; initialError: string | null }) {
  const confirm = useConfirmOrder(order.id);
  const transition = useOrderTransition(order.id);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const next = NEXT_ACTION[order.status];
  const busy = confirm.isPending || transition.isPending;
  const error = confirm.error?.message ?? transition.error?.message ?? (confirm.isIdle && transition.isIdle ? initialError : null);

  return (
    <div className="ml-auto flex max-w-xl flex-col items-end gap-2 print:hidden">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Hoja de preparación</Button>
        {order.status === 'DRAFT' && can('orders.order.write') && <Button variant="outline" size="sm" onClick={onEdit}>Editar</Button>}
        {order.nextStatuses.includes('CANCELLED') && can('orders.order.confirm') && !cancelling && (
          <Button variant="outline" size="sm" onClick={() => setCancelling(true)}>Cancelar pedido</Button>
        )}
        {order.status === 'DRAFT' && can('orders.order.confirm') && (
          <Button size="sm" disabled={busy} onClick={() => confirm.mutate(undefined)}>{confirm.isPending ? 'Reservando stock…' : 'Confirmar y reservar stock'}</Button>
        )}
        {next && can('orders.order.write') && (
          <Button size="sm" disabled={busy} onClick={() => transition.mutate({ to: next.to })}>{next.label}</Button>
        )}
      </div>
      {cancelling && (
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            transition.mutate({ to: 'CANCELLED', reason }, { onSuccess: () => setCancelling(false) });
          }}
        >
          <Input autoFocus aria-label="Motivo de la cancelación" placeholder="Motivo de la cancelación" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" variant="destructive" size="sm" className="h-9" disabled={!reason.trim() || busy}>Cancelar</Button>
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setCancelling(false)}>Volver</Button>
        </form>
      )}
      {order.status === 'READY' && <p className="text-xs text-muted-foreground">Al despachar se descuenta el stock de los lotes reservados.</p>}
      {error && <p className="text-right text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Lines({ order }: { order: OrderDetail }) {
  const showLots = order.lines.some((l) => l.lots.length);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Producto</th>
            <th className="px-4 py-3 text-right font-medium">Cantidad</th>
            {showLots && <th className="px-4 py-3 font-medium">Lotes</th>}
            {order.status === 'DRAFT' && <th className="px-4 py-3 text-right font-medium print:hidden">Disponible</th>}
            <th className="px-4 py-3 text-right font-medium">Precio</th>
            <th className="px-4 py-3 text-right font-medium">Desc.</th>
            <th className="px-4 py-3 text-right font-medium">Total</th>
            <th className="hidden px-4 py-3 font-medium print:table-cell">Preparado</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.id} className="border-b last:border-0 align-top">
              <td className="px-4 py-2.5">
                <div>{l.description}</div>
                <div className="font-mono text-xs text-muted-foreground">{l.sku}</div>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{number(l.quantity)}</td>
              {showLots && (
                <td className="px-4 py-2.5 text-xs">
                  {l.lots.map((x, i) => <div key={i}>{x.lot ?? 'sin lote'} × {number(x.quantity)}{x.expiresAt && <span className="text-muted-foreground"> · vence {date(x.expiresAt)}</span>}</div>)}
                </td>
              )}
              {order.status === 'DRAFT' && (
                <td className={cn('px-4 py-2.5 text-right tabular-nums print:hidden', (l.available ?? 0) < l.quantity && 'font-medium text-destructive')}>{number(l.available)}</td>
              )}
              <td className="px-4 py-2.5 text-right tabular-nums">{money(l.unitPrice)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{l.discountPct ? `${number(l.discountPct)} %` : '—'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{money(l.lineTotal)}</td>
              <td className="hidden px-4 py-2.5 print:table-cell">☐</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t text-sm">
          {!!order.discountTotal && (
            <tr><td colSpan={10} className="px-4 pt-3 text-right text-muted-foreground">Descuentos − {money(order.discountTotal)}</td></tr>
          )}
          <tr><td colSpan={10} className="px-4 py-3 text-right text-base font-semibold">Total sin IVA {money(order.total)}</td></tr>
          {order.marginTotal != null && (
            <tr className="print:hidden"><td colSpan={10} className="px-4 pb-3 text-right text-muted-foreground">Margen {money(order.marginTotal)}</td></tr>
          )}
        </tfoot>
      </table>
    </Card>
  );
}

function History({ order }: { order: OrderDetail }) {
  return (
    <Card className="print:hidden">
      <CardHeader><CardTitle>Historial</CardTitle></CardHeader>
      <CardContent>
        <ol className="space-y-1.5 text-sm">
          {order.history.map((h, i) => (
            <li key={i} className="flex flex-wrap gap-2">
              <span className="w-36 text-muted-foreground">{new Date(h.at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span>{STATUS_LABEL[h.to]}</span>
              {h.reason && <span className="text-muted-foreground">· {h.reason}</span>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function EditDraft({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const update = useUpdateOrder(order.id);
  return (
    <>
      <OrderForm
        lockCustomer
        initial={{
          customer: { id: order.customer.id, name: order.customer.tradeName ?? order.customer.legalName },
          warehouseId: order.warehouse.id,
          requestedDate: order.requestedDate?.slice(0, 10) ?? '',
          notes: order.notes ?? '',
          lines: order.lines.map((l) => ({
            variantId: l.variantId,
            sku: l.sku,
            description: l.description,
            quantity: String(l.quantity),
            unitPrice: String(l.unitPrice),
            discountPct: String(l.discountPct),
          })),
        }}
        submitting={update.isPending}
        error={update.error?.message}
        actions={[
          {
            label: 'Guardar cambios',
            onSubmit: (d) =>
              update.mutate(
                { version: order.version, warehouseId: d.warehouseId, requestedDate: d.requestedDate, notes: d.notes ?? '', lines: d.lines },
                { onSuccess: onDone },
              ),
          },
        ]}
      />
      <div className="flex justify-end"><Button variant="ghost" onClick={onDone}>Descartar cambios</Button></div>
    </>
  );
}
