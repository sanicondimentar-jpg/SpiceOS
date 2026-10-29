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
  type Shortage,
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
  const [shortages, setShortages] = useState<Shortage[] | null>(null);
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
            <Badge>{o.withInvoice ? 'Con factura' : 'Sin factura'}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            <Link href={`/customers/${o.customer.id}`} className="font-medium text-foreground hover:underline">{o.customer.tradeName ?? o.customer.legalName}</Link>
            {o.customer.taxId && ` · CUIT ${o.customer.taxId}`} · {o.warehouse.name} · {CHANNEL_LABEL[o.channel] ?? o.channel} · {date(o.createdAt)}
            {o.requestedDate && ` · entrega ${date(o.requestedDate)}`}
          </p>
        </div>
        {!editing && <Actions order={o} can={can} onEdit={() => setEditing(true)} onConfirmed={setShortages} initialError={initialError} />}
      </div>

      {shortages && <ShortagesResult shortages={shortages} onClose={() => setShortages(null)} />}
      {o.status === 'PENDING_REVIEW' && !editing && <WebReview order={o} />}

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

/** Motivos rápidos para descartar un pedido web. */
const DISCARD_REASONS = ['Pedido duplicado', 'Pedido mal hecho', 'El cliente lo canceló'];

function Actions({ order, can, onEdit, onConfirmed, initialError }: {
  order: OrderDetail;
  can: (p: string) => boolean;
  onEdit: () => void;
  onConfirmed: (shortages: Shortage[] | null) => void;
  initialError: string | null;
}) {
  const confirm = useConfirmOrder(order.id);
  const transition = useOrderTransition(order.id);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const next = NEXT_ACTION[order.status];
  const busy = confirm.isPending || transition.isPending;
  const error = confirm.error?.message ?? transition.error?.message ?? (confirm.isIdle && transition.isIdle ? initialError : null);
  const review = order.status === 'PENDING_REVIEW';

  return (
    <div className="ml-auto flex max-w-xl flex-col items-end gap-2 print:hidden">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Hoja de preparación</Button>
        {(order.status === 'DRAFT' || review) && can('orders.order.write') && <Button variant="outline" size="sm" onClick={onEdit}>Editar</Button>}
        {order.nextStatuses.includes('CANCELLED') && can('orders.order.confirm') && !cancelling && (
          <Button variant="outline" size="sm" onClick={() => setCancelling(true)}>{review ? 'Descartar' : 'Cancelar pedido'}</Button>
        )}
        {(order.status === 'DRAFT' || review) && can('orders.order.confirm') && (
          <Button size="sm" disabled={busy} onClick={() => confirm.mutate(undefined, { onSuccess: (r) => onConfirmed(r.shortages.length ? r.shortages : null) })}>
            {confirm.isPending ? 'Reservando stock…' : review ? 'Aprobar y reservar stock' : 'Confirmar y reservar stock'}
          </Button>
        )}
        {next && can('orders.order.write') && (
          <Button size="sm" disabled={busy} onClick={() => transition.mutate({ to: next.to })}>{next.label}</Button>
        )}
      </div>
      {cancelling && review && (
        <div className="flex flex-wrap justify-end gap-2">
          {DISCARD_REASONS.map((r) => (
            <Button key={r} type="button" variant="outline" size="sm" className={cn(reason === r && 'border-primary text-primary')} onClick={() => setReason(r)}>{r}</Button>
          ))}
        </div>
      )}
      {cancelling && (
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            transition.mutate({ to: 'CANCELLED', reason }, { onSuccess: () => setCancelling(false) });
          }}
        >
          <Input autoFocus aria-label="Motivo" placeholder={review ? 'Motivo del descarte' : 'Motivo de la cancelación'} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" variant="destructive" size="sm" className="h-9" disabled={!reason.trim() || busy}>{review ? 'Descartar' : 'Cancelar'}</Button>
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setCancelling(false)}>Volver</Button>
        </form>
      )}
      {order.status === 'READY' && <p className="text-xs text-muted-foreground">Al despachar se descuenta el stock de los lotes reservados.</p>}
      {review && <p className="text-right text-xs text-muted-foreground">Al aprobarlo se reserva lo que hay en stock; lo que falte se suma a la nota de pedido del proveedor.</p>}
      {error && <p className="text-right text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Lines({ order }: { order: OrderDetail }) {
  const showLots = order.lines.some((l) => l.lots.length);
  const showAvailable = order.status === 'DRAFT' || order.status === 'PENDING_REVIEW';
  const showMissing = order.lines.some((l) => l.backorderQty > 0);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Producto</th>
            <th className="px-4 py-3 text-right font-medium">Cantidad</th>
            {showLots && <th className="px-4 py-3 font-medium">Lotes</th>}
            {showAvailable && <th className="px-4 py-3 text-right font-medium print:hidden">Disponible</th>}
            {showMissing && <th className="px-4 py-3 font-medium">Falta</th>}
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
              {showAvailable && (
                <td className={cn('px-4 py-2.5 text-right tabular-nums print:hidden', (l.available ?? 0) < l.quantity && 'font-medium text-destructive')}>{number(l.available)}</td>
              )}
              {showMissing && (
                <td className="px-4 py-2.5 text-xs">
                  {l.backorderQty > 0 && (
                    <>
                      <span className="font-medium text-destructive">{number(l.backorderQty)}</span>
                      {l.purchaseOrder && (
                        <> · <Link href={`/purchases/${l.purchaseOrder.id}`} className="hover:underline">{l.purchaseOrder.number}</Link></>
                      )}
                    </>
                  )}
                </td>
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
          <tr><td colSpan={10} className="px-4 pt-3 text-right text-muted-foreground">Total sin IVA {money(order.total)}</td></tr>
          <tr><td colSpan={10} className="px-4 pt-1 text-right text-muted-foreground">{order.withInvoice ? `IVA 21 % ${money(order.taxTotal)}` : 'Sin factura: no lleva IVA'}</td></tr>
          <tr><td colSpan={10} className="px-4 py-3 text-right text-base font-semibold">Total a cobrar {money(order.grandTotal)}</td></tr>
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
        lockCustomer={order.status !== 'PENDING_REVIEW'}
        initial={{
          customer: { id: order.customer.id, name: order.customer.tradeName ?? order.customer.legalName },
          warehouseId: order.warehouse.id,
          withInvoice: order.withInvoice,
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
                { version: order.version, customerId: d.customerId, warehouseId: d.warehouseId, withInvoice: d.withInvoice, requestedDate: d.requestedDate, notes: d.notes ?? '', lines: d.lines },
                { onSuccess: onDone },
              ),
          },
        ]}
      />
      <div className="flex justify-end"><Button variant="ghost" onClick={onDone}>Descartar cambios</Button></div>
    </>
  );
}

/** Datos del pedido web para decidir si se aprueba: quién lo hizo, total que vio y posibles repetidos. */
function WebReview({ order }: { order: OrderDetail }) {
  const phone = order.contactPhone?.replace(/\D/g, '');
  const diff = order.webTotal != null ? Math.round(order.total - order.webTotal) : 0;
  return (
    <Card className="border-warning/50 bg-warning/5 print:hidden">
      <CardContent className="space-y-2 p-4 text-sm">
        <p className="font-medium">Pedido recibido desde la web: revisalo antes de aprobarlo.</p>
        <p>
          Lo hizo <span className="font-medium">{order.contactName}</span>
          {phone && (
            <>
              {' '}· <a className="underline" href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer">{order.contactPhone}</a>
            </>
          )}
          {order.createdCustomer ? ' · cliente nuevo (se creó como prospecto con este pedido)' : ' · cliente existente, encontrado por teléfono'}.
        </p>
        {order.webTotal != null && diff !== 0 && (
          <p>
            En la web vio un total de {money(order.webTotal)} sin IVA; con los precios actuales da {money(order.total)} ({diff > 0 ? '+' : '−'}
            {money(Math.abs(diff))}).
          </p>
        )}
        {order.possibleDuplicates.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
            <p className="font-medium">¿Duplicado? El mismo cliente tiene otros pedidos de los últimos 7 días:</p>
            <ul className="mt-1 space-y-0.5">
              {order.possibleDuplicates.map((d) => (
                <li key={d.id}>
                  <Link href={`/orders/${d.id}`} className="font-mono text-xs underline">{d.number}</Link> · {STATUS_LABEL[d.status]} · {money(d.total)} sin IVA · {date(d.createdAt)}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-muted-foreground">Si algo está mal, usá Editar para corregir productos, cantidades, precios o el cliente. Si está repetido o no corresponde, descartalo.</p>
      </CardContent>
    </Card>
  );
}

/** Resultado de la confirmación cuando faltó mercadería. */
function ShortagesResult({ shortages, onClose }: { shortages: Shortage[]; onClose: () => void }) {
  return (
    <Card className="border-primary/40 print:hidden">
      <CardContent className="space-y-2 p-4 text-sm">
        <div className="flex items-start gap-2">
          <p className="flex-1 font-medium">Pedido confirmado. Faltó mercadería en algunos productos:</p>
          <Button variant="ghost" size="sm" onClick={onClose}>Cerrar</Button>
        </div>
        <ul className="space-y-1">
          {shortages.map((s) => (
            <li key={s.sku}>
              <span className="font-medium">{s.description}</span> ({s.sku}): faltan {number(s.missing)}.
              {s.openPacks && ` Abrí ${s.openPacks.packs} caja${s.openPacks.packs > 1 ? 's' : ''} ${s.openPacks.sku} del depósito.`}
              {s.purchase && (
                <>
                  {' '}Se pidieron {number(s.purchase.quantity)} × {s.purchase.sku} a {s.purchase.supplier} en{' '}
                  <Link href={`/purchases/${s.purchase.purchaseOrderId}`} className="underline">{s.purchase.number}</Link>.
                </>
              )}
              {s.noSupplier && <span className="text-destructive"> No tiene proveedor asignado: hay que pedirlo a mano.</span>}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">Lo que falta se reserva al empezar la preparación, cuando haya entrado la mercadería.</p>
      </CardContent>
    </Card>
  );
}
