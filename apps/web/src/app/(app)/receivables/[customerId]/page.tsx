'use client';

import type { CustomerChargeRow, CustomerPaymentRow } from '@spiceos/contracts';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useRef, useState } from 'react';
import { MessageCircle, Paperclip } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchBlob } from '@/lib/api';
import {
  ACCOUNT_PAYMENT_METHODS,
  CHARGE_STATUS_LABEL,
  CHARGE_STATUS_TONE,
  CUSTOMER_PAYMENT_METHOD_LABEL,
  NOTICE_LABEL,
  day,
  dueText,
  today,
  useAttachCustomerProof,
  useCancelCustomerCharge,
  useCancelCustomerPayment,
  useCreateCustomerCharge,
  useCreateCustomerPayment,
  useCustomerAccount,
  useRemindCustomer,
  useUpdateCustomerCharge,
} from '@/lib/collections';
import { optNumber, optText } from '@/lib/form';
import { useMe } from '@/lib/hooks';
import { cn, money } from '@/lib/utils';

/** Montos como los escribe la gente: "53.500", "53500", "53.500,50". */
function amountOf(s: string) {
  const t = s.trim();
  if (/^\$?\s*\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return optNumber(t.replace(/\./g, '').replace(',', '.'));
  return optNumber(t);
}

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

export default function CustomerAccountPage() {
  return (
    <Suspense>
      <Account />
    </Suspense>
  );
}

function Account() {
  const { customerId } = useParams<{ customerId: string }>();
  const params = useSearchParams();
  const forOrder = params.get('order');
  const { data, isLoading, error } = useCustomerAccount(customerId);
  const { data: me } = useMe();
  const canWrite = !!me?.permissions.includes('receivables.payment.write');
  const canMessage = canWrite && !!me?.permissions.includes('messaging.message.send');
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [paying, setPaying] = useState(!!forOrder);
  const [addingCharge, setAddingCharge] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);

  const open = data?.charges.filter((c) => c.status === 'UNPAID' || c.status === 'PARTIAL') ?? [];
  // Si viene desde un pedido, arranca con ese pedido elegido.
  const preselected = useMemo(() => new Set(open.filter((c) => c.order?.id === forOrder).map((c) => c.id)), [open, forOrder]);
  const chosenIds = selected ?? preselected;
  const chosen = open.filter((c) => chosenIds.has(c.id));
  const chosenTotal = chosen.reduce((s, c) => s + c.balance, 0);
  const orderPending = !!forOrder && !!data && !data.charges.some((c) => c.order?.id === forOrder);
  const toggle = (id: string) => setSelected(() => {
    const next = new Set(chosenIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const charges = data?.charges.filter((c) => showCancelled || c.status !== 'CANCELLED') ?? [];
  const payments = data?.payments.filter((p) => showCancelled || !p.cancelled) ?? [];
  const hasCancelled = !!data && (data.charges.some((c) => c.status === 'CANCELLED') || data.payments.some((p) => p.cancelled));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/receivables" className="text-sm text-muted-foreground hover:underline">← Cobranza</Link>
      {isLoading && <Skeleton className="h-32 w-full" />}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{data.name}</h1>
            <Badge className="font-mono">{data.code}</Badge>
            <Link href={`/customers/${data.customerId}`} className="text-sm text-muted-foreground hover:underline">Ver ficha</Link>
            <span className="ml-auto text-sm text-muted-foreground">Plazo: {data.termsDays ? `${data.termsDays} días desde la entrega` : 'contado'}</span>
          </div>
          {data.overdue > 0.005 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Tiene {money(data.overdue)} vencidos (hace {data.maxDaysOverdue} días). Puede hacer pedidos, pero no se le entregan hasta que regularice.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label={data.balance < -0.005 ? 'Saldo a favor' : 'Debe'} value={money(Math.abs(data.balance))} tone={data.balance > 0.005 ? 'warn' : undefined} />
            <Stat label="Vencido" value={money(data.overdue)} tone={data.overdue > 0.005 ? 'bad' : undefined} />
            <Stat label="Cobrado" value={money(data.paid)} />
            <Stat label="A cuenta" value={money(data.credit)} hint="Cobros que todavía no cubren ninguna deuda: se usan solos en el próximo pedido entregado" />
          </div>

          <Card className="overflow-x-auto">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <h2 className="font-semibold">Deudas</h2>
              {canWrite && open.length > 1 && (
                <Button size="sm" variant="outline" onClick={() => setSelected(new Set(open.map((c) => c.id)))}>Elegir todas</Button>
              )}
              {canWrite && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAddingCharge(true)}>Cargar deuda a mano</Button>}
            </div>
            {addingCharge && <NewCharge customerId={customerId} termsDays={data.termsDays} onDone={() => setAddingCharge(false)} />}
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-y text-left text-xs text-muted-foreground">
                <tr>
                  {canWrite && <th className="w-10 px-4 py-2" />}
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Detalle</th>
                  <th className="px-4 py-2 font-medium">Vence</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-right font-medium">Cobrado</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo</th>
                  <th className="px-4 py-2 font-medium">Estado</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {charges.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    No tiene deudas. Cada pedido que se marca como entregado queda acá hasta que se cobra; las deudas de antes del sistema se cargan con “Cargar deuda a mano”.
                  </td></tr>
                )}
                {charges.map((c) => (
                  <ChargeRow key={c.id} c={c} canWrite={canWrite} canMessage={canMessage && !!data.phone} checked={chosenIds.has(c.id)} onToggle={() => toggle(c.id)} />
                ))}
              </tbody>
            </table>
          </Card>

          {canWrite && (
            <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 shadow-lg">
              <span className="text-sm">
                {chosen.length
                  ? <>{chosen.length} {chosen.length === 1 ? 'deuda elegida' : 'deudas elegidas'} · saldo <span className="font-semibold">{money(chosenTotal)}</span></>
                  : orderPending ? 'Cobro de un pedido que todavía no se entregó: queda a cuenta y se usa al entregarlo.'
                  : 'Elegí qué cubre el cobro, o registralo sin elegir y se aplica a lo que vence primero.'}
              </span>
              {chosen.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Limpiar</Button>}
              <Button size="sm" className="ml-auto" onClick={() => setPaying(true)} disabled={paying}>Registrar cobro</Button>
            </div>
          )}
          {paying && canWrite && (
            <NewCollection
              key={[...chosenIds].join()}
              customerId={customerId}
              charges={chosen}
              orderId={orderPending ? forOrder! : undefined}
              suggested={chosen.length ? chosenTotal : orderPending ? 0 : Math.max(0, data.balance)}
              collector={me?.user.fullName ?? ''}
              onDone={() => { setPaying(false); setSelected(new Set()); }}
              onCancel={() => setPaying(false)}
            />
          )}

          <Card className="overflow-x-auto">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <h2 className="font-semibold">Cobros</h2>
              {hasCancelled && (
                <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Ver anulados
                </label>
              )}
            </div>
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-y text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Dinero</th>
                  <th className="px-4 py-2 text-right font-medium">Monto</th>
                  <th className="px-4 py-2 font-medium">Cubre</th>
                  <th className="px-4 py-2 font-medium">Comprobante</th>
                  <th className="px-4 py-2 font-medium">Cobró</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Todavía no hay cobros.</td></tr>}
                {payments.map((p) => <PaymentRow key={p.id} p={p} canWrite={canWrite} />)}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'warn' | 'bad'; hint?: string }) {
  return (
    <Card title={hint}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn('text-xl font-semibold tabular-nums', tone === 'warn' && 'text-warning', tone === 'bad' && 'text-destructive')}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ChargeRow({ c, canWrite, canMessage, checked, onToggle }: { c: CustomerChargeRow; canWrite: boolean; canMessage: boolean; checked: boolean; onToggle: () => void }) {
  const update = useUpdateCustomerCharge();
  const cancel = useCancelCustomerCharge();
  const remind = useRemindCustomer();
  const [editing, setEditing] = useState(false);
  const [due, setDue] = useState(c.dueDate);
  const open = c.status === 'UNPAID' || c.status === 'PARTIAL';
  const cancelled = c.status === 'CANCELLED';
  const overdue = open && (c.daysOverdue ?? -1) > 0;
  const err = update.error?.message ?? cancel.error?.message ?? remind.error?.message;
  return (
    <tr className={cn('border-b align-top last:border-0', cancelled && 'text-muted-foreground line-through', checked && 'bg-primary/5')}>
      {canWrite && (
        <td className="px-4 py-2">{open && <input type="checkbox" aria-label={`Elegir ${c.description ?? 'deuda'}`} checked={checked} onChange={onToggle} />}</td>
      )}
      <td className="px-4 py-2">{day(c.date)}</td>
      <td className="px-4 py-2">
        {c.order ? <Link href={`/orders/${c.order.id}`} className="hover:underline">{c.description ?? `Pedido ${c.order.number}`}</Link> : c.description ?? 'Deuda cargada a mano'}
        <div className="text-xs text-muted-foreground no-underline">
          {c.order ? (c.order.invoice ?? (c.order.withInvoice ? 'Con factura (sin emitir)' : 'Sin factura')) : 'Cargada a mano'}
        </div>
        {c.notices.map((n) => (
          <div key={n.kind} className={cn('text-xs', n.status === 'FAILED' ? 'text-destructive' : 'text-muted-foreground')} title={n.error ?? undefined}>
            {NOTICE_LABEL[n.kind] ?? n.kind}: {n.status === 'SENT' ? `enviado ${new Date(n.at).toLocaleDateString('es-AR')}` : n.status === 'SKIPPED' ? n.error : `no se pudo (${n.error})`}
          </div>
        ))}
      </td>
      <td className="px-4 py-2">
        {editing ? (
          <div className="flex items-center gap-1">
            <Input type="date" aria-label="Vencimiento" className="h-8 w-40" value={due} onChange={(e) => setDue(e.target.value)} />
            <Button size="sm" disabled={update.isPending || !due} onClick={() => update.mutate({ id: c.id, dueDate: due }, { onSuccess: () => setEditing(false) })}>OK</Button>
          </div>
        ) : (
          <>
            {day(c.dueDate)}
            {open && <div className={cn('text-xs', overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>{dueText(c.daysOverdue)}</div>}
          </>
        )}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{money(c.total)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{money(c.paid)}</td>
      <td className="px-4 py-2 text-right font-medium tabular-nums">{cancelled ? '—' : money(c.balance)}</td>
      <td className="px-4 py-2"><Badge tone={overdue ? 'bad' : CHARGE_STATUS_TONE[c.status]}>{overdue ? 'Vencida' : CHARGE_STATUS_LABEL[c.status]}</Badge></td>
      <td className="px-4 py-2 text-right">
        {canWrite && !cancelled && (
          <div className="flex flex-wrap justify-end gap-1">
            {open && canMessage && (
              <Button
                size="sm"
                variant="ghost"
                disabled={remind.isPending}
                title="Le manda al cliente un recordatorio por WhatsApp"
                onClick={() => confirm('¿Mandarle al cliente un recordatorio de pago por WhatsApp?') && remind.mutate(c.id)}
              >
                <MessageCircle className="h-4 w-4" /> {remind.isSuccess ? 'Enviado' : 'Recordar'}
              </Button>
            )}
            {open && !editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Cambiar vencimiento</Button>}
            {c.paid <= 0.005 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={cancel.isPending}
                onClick={() => confirm('¿Anular esta deuda? Deja de figurar en lo que debe el cliente (el pedido no cambia).') && cancel.mutate(c.id)}
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

function PaymentRow({ p, canWrite }: { p: CustomerPaymentRow; canWrite: boolean }) {
  const attach = useAttachCustomerProof();
  const cancel = useCancelCustomerPayment();
  const input = useRef<HTMLInputElement>(null);
  return (
    <tr className={cn('border-b align-top last:border-0', p.cancelled && 'text-muted-foreground')}>
      <td className="px-4 py-2">{day(p.date)}{p.cancelled && <Badge className="ml-2">Anulado</Badge>}</td>
      <td className="px-4 py-2">
        <Badge tone={p.bucket === 'CASH' ? 'good' : 'brand'}>{p.bucket === 'CASH' ? 'Efectivo' : 'En cuenta'}</Badge>
        {p.bucket === 'ACCOUNT' && <span className="ml-1 text-xs">{CUSTOMER_PAYMENT_METHOD_LABEL[p.method] ?? p.method}</span>}
        {p.reference && <div className="text-xs text-muted-foreground">Op. {p.reference}</div>}
        {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
      </td>
      <td className="px-4 py-2 text-right font-medium tabular-nums">{money(p.amount)}</td>
      <td className="px-4 py-2 text-xs">
        {p.allocations.map((a) => <div key={a.chargeId}>{a.label}: {money(a.amount)}</div>)}
        {p.unallocated > 0.005 && <div className="text-muted-foreground">A cuenta: {money(p.unallocated)}{p.order && ` (para el pedido ${p.order.number})`}</div>}
      </td>
      <td className="px-4 py-2">
        {p.hasProof ? (
          <button className="inline-flex items-center gap-1 text-sm underline" onClick={() => openFile(`/customer-payments/${p.id}/proof`)}>
            <Paperclip className="h-3.5 w-3.5" /> {p.proofType === 'application/pdf' ? 'Ver PDF' : 'Ver foto'}
          </button>
        ) : p.bucket === 'CASH' ? (
          <span className="text-xs text-muted-foreground">—</span>
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
      <td className="px-4 py-2 text-xs">{p.collectedBy ?? p.createdBy ?? '—'}</td>
      <td className="px-4 py-2 text-right">
        {canWrite && !p.cancelled && (
          <Button
            size="sm"
            variant="ghost"
            disabled={cancel.isPending}
            onClick={() => confirm('¿Anular este cobro? Lo que cubría vuelve a quedar a cobrar.') && cancel.mutate(p.id)}
          >
            Anular
          </Button>
        )}
      </td>
    </tr>
  );
}

function NewCollection({ customerId, charges, orderId, suggested, collector, onDone, onCancel }: {
  customerId: string;
  charges: CustomerChargeRow[];
  orderId?: string;
  suggested: number;
  collector: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const create = useCreateCustomerPayment(customerId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [v, setV] = useState({
    date: today(),
    cash: '',
    account: suggested ? String(Math.round(suggested * 100) / 100) : '',
    method: 'TRANSFER',
    reference: '',
    notes: '',
    collectedBy: collector,
  });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (file?.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  const cash = amountOf(v.cash) ?? 0;
  const account = amountOf(v.account) ?? 0;
  const total = (Number.isNaN(cash) ? 0 : cash) + (Number.isNaN(account) ? 0 : account);
  const extra = total - suggested;

  const submit = () => {
    setError(null);
    if (Number.isNaN(cash) || Number.isNaN(account) || cash < 0 || account < 0) return setError('Revisá los montos');
    if (total <= 0) return setError('Poné cuánto se cobró en efectivo o en cuenta');
    if (account > 0 && !file && !confirm('No adjuntaste el comprobante de la transferencia. ¿Registrar el cobro igual? Lo podés adjuntar después.')) return;
    create.mutate(
      {
        date: v.date,
        cashAmount: cash,
        accountAmount: account,
        accountMethod: v.method,
        reference: optText(v.reference),
        notes: optText(v.notes),
        collectedBy: optText(v.collectedBy),
        chargeIds: charges.map((c) => c.id),
        orderId,
        file: account > 0 ? file : null,
      },
      { onSuccess: onDone, onError: (e) => setError(e.message) },
    );
  };

  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-4 p-5">
        <h2 className="font-semibold">Registrar cobro</h2>
        <p className="text-sm text-muted-foreground">
          {charges.length
            ? <>Cubre {charges.map((c) => c.description ?? `deuda del ${day(c.date)}`).join(', ')}.</>
            : orderId ? 'El pedido todavía no se entregó: el cobro queda a cuenta y se aplica solo al entregarlo.'
            : 'No elegiste deudas: se aplica a lo que vence primero, y lo que sobre queda a cuenta.'}
          {' '}Si pagó una parte en efectivo y otra por transferencia, completá los dos montos.
        </p>
        <div className={preview ? 'grid gap-4 md:grid-cols-[1fr_220px]' : ''}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Fecha del cobro" htmlFor="col-date"><Input id="col-date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
            <Field label="Dinero en efectivo" htmlFor="col-cash"><Input id="col-cash" inputMode="decimal" placeholder="0" value={v.cash} onChange={(e) => setV({ ...v, cash: e.target.value })} /></Field>
            <Field label="Dinero en cuenta" htmlFor="col-account"><Input id="col-account" inputMode="decimal" placeholder="0" value={v.account} onChange={(e) => setV({ ...v, account: e.target.value })} /></Field>
            {account > 0 && (
              <>
                <Field label="Medio (en cuenta)" htmlFor="col-method">
                  <Select id="col-method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
                    {ACCOUNT_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{CUSTOMER_PAYMENT_METHOD_LABEL[m]}</option>)}
                  </Select>
                </Field>
                <Field label="Número de operación" htmlFor="col-ref"><Input id="col-ref" placeholder="opcional" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
              </>
            )}
            <Field label="Quién cobró" htmlFor="col-by"><Input id="col-by" value={v.collectedBy} onChange={(e) => setV({ ...v, collectedBy: e.target.value })} /></Field>
            <Field label="Nota" htmlFor="col-notes" className="sm:col-span-2"><Input id="col-notes" placeholder="opcional" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
            {account > 0 && (
              <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                <Button variant="outline" onClick={() => fileInput.current?.click()}>
                  <Paperclip className="mr-2 h-4 w-4" /> {file ? 'Cambiar comprobante' : 'Adjuntar comprobante'}
                </Button>
                <span className="text-sm text-muted-foreground">{file ? file.name : 'Foto o PDF de la transferencia.'}</span>
              </div>
            )}
          </div>
          {preview && account > 0 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Comprobante" className="max-h-72 w-full rounded-md border object-contain" />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-sm">
            Total <span className="font-semibold">{money(total)}</span>
            {suggested > 0 && extra > 0.005 && <span className="text-muted-foreground"> · sobran {money(extra)}: quedan a cuenta</span>}
            {suggested > 0 && extra < -0.005 && total > 0 && <span className="text-muted-foreground"> · faltan {money(-extra)}: queda saldo</span>}
          </span>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button disabled={create.isPending} onClick={submit}>{create.isPending ? 'Guardando…' : 'Guardar cobro'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NewCharge({ customerId, termsDays, onDone }: { customerId: string; termsDays: number; onDone: () => void }) {
  const create = useCreateCustomerCharge(customerId);
  const [v, setV] = useState({ date: today(), dueDate: '', total: '', description: '' });
  const total = amountOf(v.total);
  return (
    <div className="grid gap-3 border-t bg-accent/20 p-4 sm:grid-cols-4">
      <Field label="Fecha" htmlFor="nc-date"><Input id="nc-date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
      <Field label="Vence" htmlFor="nc-due" hint={v.dueDate ? undefined : `Si lo dejás vacío: ${termsDays} días`}><Input id="nc-due" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} /></Field>
      <Field label="Monto" htmlFor="nc-total"><Input id="nc-total" inputMode="decimal" value={v.total} onChange={(e) => setV({ ...v, total: e.target.value })} /></Field>
      <Field label="Detalle" htmlFor="nc-desc"><Input id="nc-desc" placeholder="Ej.: pedido del 10/11" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      <p className="text-xs text-muted-foreground sm:col-span-4">Para lo que ya debía antes de usar el sistema. Los pedidos entregados se cargan solos.</p>
      <div className="flex items-center justify-end gap-2 sm:col-span-4">
        {create.error && <p className="mr-auto text-sm text-destructive">{create.error.message}</p>}
        <Button variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button
          disabled={create.isPending || !v.date || total === undefined || Number.isNaN(total) || total <= 0}
          onClick={() => create.mutate({ date: v.date, dueDate: v.dueDate || undefined, total: total!, description: optText(v.description) }, { onSuccess: onDone })}
        >
          Guardar deuda
        </Button>
      </div>
    </div>
  );
}
