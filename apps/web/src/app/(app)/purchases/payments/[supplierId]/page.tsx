'use client';

import type { SupplierPaymentMethod, SupplierPaymentRow, SupplierPurchaseRow } from '@spiceos/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchBlob } from '@/lib/api';
import { optNumber, optText } from '@/lib/form';
import { useMe } from '@/lib/hooks';
import {
  PURCHASE_STATUS_LABEL,
  PURCHASE_STATUS_TONE,
  SUPPLIER_PAYMENT_METHODS,
  SUPPLIER_PAYMENT_METHOD_LABEL,
  day,
  today,
  useAttachPaymentProof,
  useCancelSupplierPayment,
  useCancelSupplierPurchase,
  useCreateSupplierPayment,
  useCreateSupplierPurchase,
  useSupplierAccount,
  useUpdateSupplierPurchase,
} from '@/lib/supplier-accounts';
import { money } from '@/lib/utils';

/** Abre un archivo protegido (comprobante o foto del remito) en otra pestaña. */
function openFile(path: string) {
  const w = window.open('', '_blank');
  fetchBlob(path)
    .then((b) => {
      const url = URL.createObjectURL(b);
      if (w) w.location.href = url;
      else window.location.href = url;
    })
    .catch((e: Error) => {
      w?.close();
      alert(e.message);
    });
}

export default function SupplierAccountPage() {
  const { supplierId } = useParams<{ supplierId: string }>();
  const { data, isLoading, error } = useSupplierAccount(supplierId);
  const { data: me } = useMe();
  const canWrite = !!me?.permissions.includes('purchasing.order.write');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [addingPurchase, setAddingPurchase] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);

  const open = data?.purchases.filter((p) => p.status === 'UNPAID' || p.status === 'PARTIAL') ?? [];
  const chosen = open.filter((p) => selected.has(p.id));
  const chosenTotal = chosen.reduce((s, p) => s + p.balance, 0);
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const purchases = data?.purchases.filter((p) => showCancelled || p.status !== 'CANCELLED') ?? [];
  const payments = data?.payments.filter((p) => showCancelled || !p.cancelled) ?? [];
  const hasCancelled = !!data && (data.purchases.some((p) => p.status === 'CANCELLED') || data.payments.some((p) => p.cancelled));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/purchases/payments" className="text-sm text-muted-foreground hover:underline">← Pagos a proveedores</Link>
      {isLoading && <Skeleton className="h-32 w-full" />}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{data.name}</h1>
            <Badge className="font-mono">{data.code}</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label={data.balance < -0.005 ? 'Saldo a favor' : 'Le debés'} value={money(Math.abs(data.balance))} tone={data.balance > 0.005 ? 'warn' : undefined} />
            <Stat label="Comprado" value={money(data.purchased)} />
            <Stat label="Pagado" value={money(data.paid)} />
            <Stat label="Pagos sin imputar" value={money(data.credit)} hint="Lo que sobró de pagos que no cubrían compras" />
          </div>

          <Card className="overflow-x-auto">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <h2 className="font-semibold">Compras</h2>
              {canWrite && !!open.length && (
                <Button size="sm" variant="outline" onClick={() => setSelected(new Set(open.map((p) => p.id)))}>Elegir todas las que están a pagar</Button>
              )}
              {canWrite && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAddingPurchase(true)}>Cargar compra a mano</Button>}
            </div>
            {addingPurchase && <NewPurchase supplierId={supplierId} onDone={() => setAddingPurchase(false)} />}
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-y text-left text-xs text-muted-foreground">
                <tr>
                  {canWrite && <th className="w-10 px-4 py-2" />}
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Remito o factura</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-right font-medium">Pagado</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {purchases.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    Todavía no hay compras. Se cargan solas al registrar un ingreso de mercadería eligiendo este proveedor, o con “Cargar compra a mano”.
                  </td></tr>
                )}
                {purchases.map((p) => (
                  <PurchaseRow key={p.id} p={p} canWrite={canWrite} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} />
                ))}
              </tbody>
            </table>
          </Card>

          {canWrite && (
            <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 shadow-lg">
              <span className="text-sm">
                {chosen.length
                  ? <>{chosen.length} {chosen.length === 1 ? 'compra elegida' : 'compras elegidas'} · saldo <span className="font-semibold">{money(chosenTotal)}</span></>
                  : 'Elegí las compras que cubre el pago (podés elegir varias para un solo comprobante).'}
              </span>
              {chosen.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpiar</Button>}
              <Button size="sm" className="ml-auto" onClick={() => setPaying(true)} disabled={paying}>Registrar pago</Button>
            </div>
          )}
          {paying && (
            <NewPayment
              key={[...selected].join()}
              supplierId={supplierId}
              purchases={chosen}
              suggested={chosenTotal}
              onDone={() => { setPaying(false); setSelected(new Set()); }}
              onCancel={() => setPaying(false)}
            />
          )}

          <Card className="overflow-x-auto">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <h2 className="font-semibold">Pagos</h2>
              {hasCancelled && (
                <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Ver anulados
                </label>
              )}
            </div>
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-y text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Medio</th>
                  <th className="px-4 py-2 text-right font-medium">Monto</th>
                  <th className="px-4 py-2 font-medium">Cubre</th>
                  <th className="px-4 py-2 font-medium">Comprobante</th>
                  <th className="px-4 py-2 font-medium">Cargó</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Todavía no hay pagos.</td></tr>}
                {payments.map((p) => <PaymentRow key={p.id} p={p} canWrite={canWrite} />)}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'warn'; hint?: string }) {
  return (
    <Card title={hint}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${tone === 'warn' ? 'text-warning' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function PurchaseRow({ p, canWrite, checked, onToggle }: { p: SupplierPurchaseRow; canWrite: boolean; checked: boolean; onToggle: () => void }) {
  const update = useUpdateSupplierPurchase();
  const cancel = useCancelSupplierPurchase();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ date: p.date, reference: p.reference ?? '', total: String(p.total) });
  const payable = p.status === 'UNPAID' || p.status === 'PARTIAL';
  const cancelled = p.status === 'CANCELLED';
  const err = update.error?.message ?? cancel.error?.message;

  if (editing) {
    const total = optNumber(v.total);
    return (
      <tr className="border-b bg-accent/30">
        {canWrite && <td />}
        <td className="px-4 py-2"><Input type="date" aria-label="Fecha" className="h-8 w-40" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></td>
        <td className="px-4 py-2"><Input aria-label="Remito o factura" className="h-8" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></td>
        <td className="px-4 py-2 text-right"><Input aria-label="Total" inputMode="decimal" className="ml-auto h-8 w-32 text-right" value={v.total} onChange={(e) => setV({ ...v, total: e.target.value })} /></td>
        <td colSpan={4} className="px-4 py-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {err && <span className="mr-auto text-xs text-destructive">{err}</span>}
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
            <Button
              size="sm"
              disabled={update.isPending || !v.date || total === undefined || Number.isNaN(total) || total <= 0}
              onClick={() => update.mutate({ id: p.id, date: v.date, reference: v.reference.trim() || null, total }, { onSuccess: () => setEditing(false) })}
            >
              Guardar
            </Button>
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr className={`border-b last:border-0 ${cancelled ? 'text-muted-foreground line-through' : ''} ${checked ? 'bg-primary/5' : ''}`}>
      {canWrite && (
        <td className="px-4 py-2">
          {payable && <input type="checkbox" aria-label={`Elegir compra ${p.reference ?? day(p.date)}`} checked={checked} onChange={onToggle} />}
        </td>
      )}
      <td className="px-4 py-2">{day(p.date)}</td>
      <td className="px-4 py-2">
        <div>{p.reference ?? <span className="text-muted-foreground">Sin número</span>}</div>
        <div className="text-xs text-muted-foreground no-underline">
          {p.source === 'RECEIPT' ? 'Ingreso de mercadería' : 'Cargada a mano'}
          {p.notes && ` · ${p.notes}`}
          {p.hasReceiptImage && p.pendingReceiptId && (
            <> · <button className="underline" onClick={() => openFile(`/receipts/pending/${p.pendingReceiptId}/image`)}>ver remito</button></>
          )}
        </div>
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{money(p.total)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{money(p.paid)}</td>
      <td className="px-4 py-2 text-right font-medium tabular-nums">{cancelled ? '—' : money(p.balance)}</td>
      <td className="px-4 py-2"><Badge tone={PURCHASE_STATUS_TONE[p.status]}>{PURCHASE_STATUS_LABEL[p.status]}</Badge></td>
      <td className="px-4 py-2 text-right">
        {canWrite && !cancelled && (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Editar</Button>
            {p.paid <= 0.005 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={cancel.isPending}
                onClick={() => confirm('¿Anular esta compra? No cambia el stock, solo la saca de lo que se le debe al proveedor.') && cancel.mutate(p.id)}
              >
                Anular
              </Button>
            )}
          </div>
        )}
        {err && <div className="text-xs text-destructive">{err}</div>}
      </td>
    </tr>
  );
}

function PaymentRow({ p, canWrite }: { p: SupplierPaymentRow; canWrite: boolean }) {
  const attach = useAttachPaymentProof();
  const cancel = useCancelSupplierPayment();
  const input = useRef<HTMLInputElement>(null);
  return (
    <tr className={`border-b align-top last:border-0 ${p.cancelled ? 'text-muted-foreground' : ''}`}>
      <td className="px-4 py-2">{day(p.date)}{p.cancelled && <Badge className="ml-2">Anulado</Badge>}</td>
      <td className="px-4 py-2">
        {SUPPLIER_PAYMENT_METHOD_LABEL[p.method] ?? p.method}
        {p.reference && <div className="text-xs text-muted-foreground">Op. {p.reference}</div>}
        {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
      </td>
      <td className="px-4 py-2 text-right font-medium tabular-nums">{money(p.amount)}</td>
      <td className="px-4 py-2 text-xs">
        {p.allocations.map((a) => (
          <div key={a.purchaseId}>{a.reference ?? 'Compra'} del {day(a.date)}: {money(a.amount)}</div>
        ))}
        {p.unallocated > 0.005 && <div className="text-muted-foreground">A cuenta: {money(p.unallocated)}</div>}
      </td>
      <td className="px-4 py-2">
        {p.hasProof ? (
          <button className="inline-flex items-center gap-1 text-sm underline" onClick={() => openFile(`/supplier-payments/${p.id}/proof`)}>
            <Paperclip className="h-3.5 w-3.5" /> {p.proofType === 'application/pdf' ? 'Ver PDF' : 'Ver foto'}
          </button>
        ) : (
          <Badge tone="warn">Sin comprobante</Badge>
        )}
        {canWrite && !p.cancelled && (
          <>
            <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) attach.mutate({ id: p.id, file: f }); e.target.value = ''; }} />
            <button className="ml-2 text-xs text-muted-foreground underline" disabled={attach.isPending} onClick={() => input.current?.click()}>
              {attach.isPending ? 'Subiendo…' : p.hasProof ? 'Cambiar' : 'Adjuntar'}
            </button>
          </>
        )}
        {attach.error && <div className="text-xs text-destructive">{attach.error.message}</div>}
      </td>
      <td className="px-4 py-2 text-xs">{p.createdBy ?? '—'}</td>
      <td className="px-4 py-2 text-right">
        {canWrite && !p.cancelled && (
          <Button
            size="sm"
            variant="ghost"
            disabled={cancel.isPending}
            onClick={() => confirm('¿Anular este pago? Las compras que cubría vuelven a quedar a pagar.') && cancel.mutate(p.id)}
          >
            Anular
          </Button>
        )}
      </td>
    </tr>
  );
}

function NewPayment({ supplierId, purchases, suggested, onDone, onCancel }: {
  supplierId: string;
  purchases: SupplierPurchaseRow[];
  suggested: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const create = useCreateSupplierPayment(supplierId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [v, setV] = useState({ date: today(), method: 'TRANSFER' as SupplierPaymentMethod, amount: suggested ? String(Math.round(suggested * 100) / 100) : '', reference: '', notes: '' });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (file?.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  const amount = optNumber(v.amount);
  const extra = amount !== undefined && !Number.isNaN(amount) ? amount - suggested : 0;

  const submit = () => {
    setError(null);
    if (amount === undefined || Number.isNaN(amount) || amount <= 0) return setError('Poné el monto del pago');
    if (!file && !confirm('No adjuntaste el comprobante. ¿Registrar el pago igual? Lo podés adjuntar después.')) return;
    create.mutate(
      { date: v.date, method: v.method, amount, reference: optText(v.reference), notes: optText(v.notes), purchaseIds: purchases.map((p) => p.id), file },
      { onSuccess: onDone, onError: (e) => setError(e.message) },
    );
  };

  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-4 p-5">
        <h2 className="font-semibold">Registrar pago</h2>
        <p className="text-sm text-muted-foreground">
          {purchases.length
            ? <>Cubre {purchases.map((p) => `${p.reference ?? 'compra'} del ${day(p.date)}`).join(', ')}. Se imputa de la más vieja a la más nueva.</>
            : 'No elegiste compras: el pago queda a cuenta del proveedor.'}
        </p>
        <div className={preview ? 'grid gap-4 md:grid-cols-[1fr_220px]' : ''}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Fecha del pago" htmlFor="pay-date"><Input id="pay-date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
            <Field label="Medio" htmlFor="pay-method">
              <Select id="pay-method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value as SupplierPaymentMethod })}>
                {SUPPLIER_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{SUPPLIER_PAYMENT_METHOD_LABEL[m]}</option>)}
              </Select>
            </Field>
            <Field
              label="Monto"
              htmlFor="pay-amount"
              hint={purchases.length && extra > 0.005 ? `Sobran ${money(extra)}: quedan a cuenta` : purchases.length && extra < -0.005 ? `Faltan ${money(-extra)}: la última compra queda pagada en parte` : undefined}
            >
              <Input id="pay-amount" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
            </Field>
            <Field label="Número de operación" htmlFor="pay-ref"><Input id="pay-ref" placeholder="opcional" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
            <Field label="Nota" htmlFor="pay-notes" className="sm:col-span-2"><Input id="pay-notes" placeholder="opcional" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
              <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              <Button variant="outline" onClick={() => fileInput.current?.click()}>
                <Paperclip className="mr-2 h-4 w-4" /> {file ? 'Cambiar comprobante' : 'Adjuntar comprobante'}
              </Button>
              <span className="text-sm text-muted-foreground">{file ? file.name : 'Foto o PDF de la transferencia.'}</span>
            </div>
          </div>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Comprobante" className="max-h-72 w-full rounded-md border object-contain" />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error && <p className="mr-auto text-sm text-destructive">{error}</p>}
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button disabled={create.isPending} onClick={submit}>{create.isPending ? 'Guardando…' : 'Guardar pago'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NewPurchase({ supplierId, onDone }: { supplierId: string; onDone: () => void }) {
  const create = useCreateSupplierPurchase(supplierId);
  const [v, setV] = useState({ date: today(), reference: '', total: '', notes: '' });
  const total = optNumber(v.total);
  return (
    <div className="grid gap-3 border-t bg-accent/20 p-4 sm:grid-cols-4">
      <Field label="Fecha" htmlFor="np-date"><Input id="np-date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
      <Field label="Remito o factura" htmlFor="np-ref"><Input id="np-ref" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
      <Field label="Total" htmlFor="np-total"><Input id="np-total" inputMode="decimal" value={v.total} onChange={(e) => setV({ ...v, total: e.target.value })} /></Field>
      <Field label="Nota" htmlFor="np-notes"><Input id="np-notes" placeholder="opcional" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      <p className="text-xs text-muted-foreground sm:col-span-4">No suma stock: es para compras cuya mercadería ya está cargada, fletes u otros gastos con este proveedor.</p>
      <div className="flex items-center justify-end gap-2 sm:col-span-4">
        {create.error && <p className="mr-auto text-sm text-destructive">{create.error.message}</p>}
        <Button variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button
          disabled={create.isPending || !v.date || total === undefined || Number.isNaN(total) || total <= 0}
          onClick={() => create.mutate({ date: v.date, reference: optText(v.reference), total: total!, notes: optText(v.notes) }, { onSuccess: onDone })}
        >
          Guardar compra
        </Button>
      </div>
    </div>
  );
}
