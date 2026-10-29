'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { VariantPicker } from '@/components/orders/order-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { optNumber } from '@/lib/form';
import { useMe } from '@/lib/hooks';
import { STATUS_LABEL, type OrderStatus } from '@/lib/orders';
import {
  PO_STATUS_LABEL,
  PO_STATUS_TONE,
  purchaseOrderText,
  usePurchaseOrder,
  usePurchaseOrderTransition,
  useUpdatePurchaseOrder,
  type PurchaseOrderDetail,
} from '@/lib/purchasing';
import { date, money, number } from '@/lib/utils';

export default function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: po, isLoading } = usePurchaseOrder(id);
  const { data: me } = useMe();
  const canWrite = !!me?.permissions.includes('purchasing.order.write');
  if (isLoading || !po) return <Skeleton className="mx-auto h-96 max-w-6xl" />;
  const company = me?.company.tradeName ?? me?.company.legalName ?? '';

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/purchases" className="text-sm text-muted-foreground hover:underline print:hidden">← Notas de pedido</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Nota de pedido {po.number}</h1>
            <Badge tone={PO_STATUS_TONE[po.status]}>{PO_STATUS_LABEL[po.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {po.supplier.legalName}
            {po.supplier.phone && ` · ${po.supplier.phone}`}
            {po.supplier.email && ` · ${po.supplier.email}`} · creada {date(po.createdAt)}
            {po.sentAt && ` · enviada ${date(po.sentAt)}`}
          </p>
        </div>
        <Actions po={po} canWrite={canWrite} company={company} />
      </div>
      {po.status === 'DRAFT' && canWrite ? <EditableLines key={po.version} po={po} /> : <Lines po={po} />}
      {po.notes && <Card><CardContent className="whitespace-pre-line p-4 text-sm"><span className="text-muted-foreground">Notas: </span>{po.notes}</CardContent></Card>}
    </div>
  );
}

function Actions({ po, canWrite, company }: { po: PurchaseOrderDetail; canWrite: boolean; company: string }) {
  const transition = usePurchaseOrderTransition(po.id);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState(false);
  const text = purchaseOrderText(po, company);
  const phone = po.supplier.phone?.replace(/\D/g, '');
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="ml-auto flex max-w-xl flex-col items-end gap-2 print:hidden">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={copy}><Copy className="h-4 w-4" /> {copied ? 'Copiada' : 'Copiar texto'}</Button>
        {phone && (
          <Button asChild variant="outline" size="sm">
            <a href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Mandar por WhatsApp</a>
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => window.print()}>Imprimir</Button>
        {canWrite && po.nextStatuses.includes('CANCELLED') && !cancelling && <Button variant="outline" size="sm" onClick={() => setCancelling(true)}>Cancelar</Button>}
        {canWrite && po.nextStatuses.includes('SENT') && (
          <Button size="sm" disabled={transition.isPending || !po.lines.length} onClick={() => transition.mutate({ to: 'SENT' })}>Marcar enviada</Button>
        )}
        {canWrite && po.nextStatuses.includes('RECEIVED') && (
          <Button size="sm" disabled={transition.isPending} onClick={() => transition.mutate({ to: 'RECEIVED' })}>Marcar recibida</Button>
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
          <Button type="submit" variant="destructive" size="sm" className="h-9" disabled={!reason.trim() || transition.isPending}>Cancelar</Button>
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setCancelling(false)}>Volver</Button>
        </form>
      )}
      {po.status === 'DRAFT' && <p className="text-right text-xs text-muted-foreground">Mientras esté en borrador se le siguen sumando los faltantes de pedidos nuevos.</p>}
      {(po.status === 'SENT' || po.status === 'RECEIVED') && (
        <p className="text-right text-xs text-muted-foreground">
          Cuando llegue la mercadería, cargá el ingreso con lote y vencimiento en{' '}
          <Link href="/inventory/receive" className="underline">Inventario → Ingresar mercadería</Link>.
        </p>
      )}
      {transition.error && <p className="text-right text-sm text-destructive">{transition.error.message}</p>}
    </div>
  );
}

function Orders({ orders }: { orders: PurchaseOrderDetail['lines'][number]['orders'] }) {
  if (!orders.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5">
      {orders.map((o) => (
        <div key={`${o.id}-${o.sku}`}>
          <Link href={`/orders/${o.id}`} className="font-mono hover:underline">{o.number}</Link>
          <span className="text-muted-foreground"> · {STATUS_LABEL[o.status as OrderStatus]?.toLowerCase() ?? o.status}{o.missing > 0 && ` · faltan ${number(o.missing)} ${o.sku}`}</span>
        </div>
      ))}
    </div>
  );
}

function Lines({ po }: { po: PurchaseOrderDetail }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Producto</th>
            <th className="px-4 py-3 text-right font-medium">Cantidad</th>
            <th className="px-4 py-3 text-right font-medium">Costo</th>
            <th className="px-4 py-3 text-right font-medium">Total</th>
            <th className="px-4 py-3 font-medium print:hidden">Para los pedidos</th>
          </tr>
        </thead>
        <tbody>
          {po.lines.map((l) => (
            <tr key={l.id} className="border-b last:border-0 align-top">
              <td className="px-4 py-2.5"><div>{l.description}</div><div className="font-mono text-xs text-muted-foreground">{l.sku}</div></td>
              <td className="px-4 py-2.5 text-right tabular-nums">{number(l.quantity)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{money(l.unitCost)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{money(l.lineTotal)}</td>
              <td className="px-4 py-2.5 text-xs print:hidden"><Orders orders={l.orders} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t"><tr><td colSpan={5} className="px-4 py-3 text-right font-semibold">Total {money(po.total)}</td></tr></tfoot>
      </table>
    </Card>
  );
}

interface DraftLine {
  variantId: string;
  sku: string;
  description: string;
  quantity: string;
  unitCost: string;
  orders: PurchaseOrderDetail['lines'][number]['orders'];
}

/** Borrador: se pueden cambiar cantidades y costos, quitar productos o agregar otros. */
function EditableLines({ po }: { po: PurchaseOrderDetail }) {
  const update = useUpdatePurchaseOrder(po.id);
  const initial: DraftLine[] = po.lines.map((l) => ({ ...l, quantity: String(l.quantity), unitCost: String(l.unitCost) }));
  const [lines, setLines] = useState(initial);
  const [notes, setNotes] = useState(po.notes ?? '');
  const set = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const invalid = lines.find((l) => {
    const q = optNumber(l.quantity);
    const c = optNumber(l.unitCost);
    return q === undefined || Number.isNaN(q) || q < 0 || (c !== undefined && (Number.isNaN(c) || c < 0));
  });
  const total = lines.reduce((s, l) => s + (optNumber(l.quantity) ?? 0) * (optNumber(l.unitCost) ?? 0), 0);
  const save = () => {
    const kept = new Set(lines.map((l) => l.variantId));
    update.mutate({
      version: po.version,
      notes,
      lines: [
        ...lines.map((l) => ({ variantId: l.variantId, quantity: optNumber(l.quantity)!, unitCost: optNumber(l.unitCost) })),
        ...po.lines.filter((l) => !kept.has(l.variantId)).map((l) => ({ variantId: l.variantId, quantity: 0 })),
      ],
    });
  };

  return (
    <Card className="overflow-x-auto">
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle>Productos</CardTitle>
        <VariantPicker
          onPick={(v) => !lines.some((l) => l.variantId === v.variantId) && setLines((ls) => [...ls, { ...v, quantity: '1', unitCost: '', orders: [] }])}
        />
      </CardHeader>
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-y text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Producto</th>
            <th className="px-4 py-2 text-right font-medium">Cantidad</th>
            <th className="px-4 py-2 text-right font-medium">Costo</th>
            <th className="px-4 py-2 text-right font-medium">Total</th>
            <th className="px-4 py-2 font-medium">Para los pedidos</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">La nota no tiene productos.</td></tr>}
          {lines.map((l, i) => (
            <tr key={l.variantId} className="border-b last:border-0 align-top">
              <td className="px-4 py-2"><div>{l.description}</div><div className="font-mono text-xs text-muted-foreground">{l.sku}</div></td>
              <td className="px-4 py-2 text-right">
                <Input aria-label={`Cantidad de ${l.sku}`} className="ml-auto h-8 w-20 text-right" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
              </td>
              <td className="px-4 py-2 text-right">
                <Input aria-label={`Costo de ${l.sku}`} className="ml-auto h-8 w-28 text-right" inputMode="decimal" placeholder="costo actual" value={l.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{money((optNumber(l.quantity) ?? 0) * (optNumber(l.unitCost) ?? 0))}</td>
              <td className="px-4 py-2 text-xs"><Orders orders={l.orders} /></td>
              <td className="px-2 py-2">
                <Button variant="ghost" size="icon" aria-label={`Quitar ${l.sku}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <CardContent className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="po-notes" className="text-xs font-medium text-muted-foreground">Notas para el proveedor</label>
          <Input id="po-notes" value={notes} placeholder="Forma de pago, entrega, aclaraciones…" onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="text-right text-sm font-semibold">Total {money(total)}</div>
        <Button disabled={!!invalid || update.isPending} onClick={save}>{update.isPending ? 'Guardando…' : 'Guardar cambios'}</Button>
      </CardContent>
      {invalid && <p className="px-4 pb-3 text-sm text-destructive">Revisá la cantidad y el costo de {invalid.sku}.</p>}
      {update.error && <p className="px-4 pb-3 text-sm text-destructive">{update.error.message}</p>}
    </Card>
  );
}
