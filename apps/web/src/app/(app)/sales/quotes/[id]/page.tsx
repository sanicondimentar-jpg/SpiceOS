'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { Copy, Printer } from 'lucide-react';
import { OrderForm } from '@/components/orders/order-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/hooks';
import { useInvoicingStatus } from '@/lib/invoicing';
import {
  OPEN_QUOTE,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  useApproveQuote,
  useConvertQuote,
  useQuote,
  useQuoteStatus,
  useUpdateQuote,
  day,
  type QuoteDetail,
} from '@/lib/sales';
import { date, money, number } from '@/lib/utils';

export default function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: q, isLoading } = useQuote(id);
  const { data: me } = useMe();
  const [editing, setEditing] = useState(false);
  const can = (p: string) => !!me?.permissions.includes(p);
  if (isLoading || !q) return <Skeleton className="mx-auto h-96 max-w-6xl" />;
  const company = me?.company.tradeName ?? me?.company.legalName ?? '';

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="print:hidden">
        <Link href="/sales" className="text-sm text-muted-foreground hover:underline">← Ventas</Link>
      </div>
      <div className="hidden text-lg font-semibold print:block">{company}</div>
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">Presupuesto {q.number}</h1>
            <span className="print:hidden"><Badge tone={QUOTE_STATUS_TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Badge></span>
            <Badge>{q.withInvoice ? 'Con factura' : 'Sin factura'}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            <Link href={`/customers/${q.customer.id}`} className="font-medium text-foreground hover:underline">{q.customer.tradeName ?? q.customer.legalName}</Link>
            {q.customer.taxId && ` · CUIT ${q.customer.taxId}`} · {date(q.createdAt)}
            {q.validUntil && ` · válido hasta el ${day(q.validUntil)}`}
          </p>
        </div>
        {!editing && <Actions quote={q} can={can} company={company} onEdit={() => setEditing(true)} />}
      </div>

      {q.status === 'PENDING_APPROVAL' && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm print:hidden">
          Tiene descuentos o márgenes fuera de lo permitido: alguien con permiso tiene que aprobarlo antes de enviarlo.
        </p>
      )}
      {q.status === 'EXPIRED' && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm print:hidden">
          Venció la validez. Si lo pasás a pedido se respetan los precios presupuestados; para renovarlo, editalo.
        </p>
      )}
      {q.status === 'REJECTED' && q.rejectReason && (
        <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground print:hidden">Motivo del rechazo: {q.rejectReason}</p>
      )}
      {q.order && (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm print:hidden">
          Pasado a pedido <Link href={`/orders/${q.order.id}`} className="font-mono font-medium hover:underline">{q.order.number}</Link>.
        </p>
      )}

      {editing ? (
        <EditQuote quote={q} onDone={() => setEditing(false)} />
      ) : (
        <>
          {q.notes && <Card><CardContent className="p-4 text-sm"><span className="text-muted-foreground">Notas: </span>{q.notes}</CardContent></Card>}
          <Lines quote={q} />
        </>
      )}
    </div>
  );
}

function Actions({ quote, can, company, onEdit }: { quote: QuoteDetail; can: (p: string) => boolean; company: string; onEdit: () => void }) {
  const router = useRouter();
  const status = useQuoteStatus(quote.id);
  const approve = useApproveQuote(quote.id);
  const convert = useConvertQuote(quote.id);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState(false);
  const open = OPEN_QUOTE.includes(quote.status);
  const write = can('sales.quote.write');
  const busy = status.isPending || approve.isPending || convert.isPending;
  const error = status.error?.message ?? approve.error?.message ?? convert.error?.message;
  const vat = useInvoicingStatus().data?.taxCondition === 'RESPONSABLE_INSCRIPTO';

  const copy = async () => {
    await navigator.clipboard.writeText(whatsappText(quote, company, vat));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="ml-auto flex max-w-xl flex-col items-end gap-2 print:hidden">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={copy}><Copy className="h-4 w-4" /> {copied ? 'Copiado' : 'Copiar para WhatsApp'}</Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir o PDF</Button>
        {open && write && <Button variant="outline" size="sm" onClick={onEdit}>Editar</Button>}
        {quote.status === 'PENDING_APPROVAL' && can('sales.quote.approve') && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => approve.mutate(undefined)}>Aprobar descuentos</Button>
        )}
        {quote.storedStatus === 'DRAFT' && write && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => status.mutate({ status: 'SENT' })}>Marcar enviado</Button>
        )}
        {open && write && !rejecting && <Button variant="outline" size="sm" onClick={() => setRejecting(true)}>No lo aceptó</Button>}
        {quote.status === 'REJECTED' && write && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => status.mutate({ status: 'DRAFT' })}>Reabrir</Button>
        )}
        {open && quote.status !== 'PENDING_APPROVAL' && write && can('orders.order.write') && (
          <Button size="sm" disabled={busy} onClick={() => convert.mutate({}, { onSuccess: (r) => router.push(`/orders/${r.orderId}`) })}>
            {convert.isPending ? 'Armando pedido…' : 'Pasar a pedido'}
          </Button>
        )}
      </div>
      {rejecting && (
        <form
          className="flex w-full gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            status.mutate({ status: 'REJECTED', reason: reason.trim() || undefined }, { onSuccess: () => setRejecting(false) });
          }}
        >
          <Input autoFocus aria-label="Motivo" placeholder="¿Por qué? (precio, ya compró, no le interesa…)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" variant="destructive" size="sm" className="h-9" disabled={busy}>Guardar</Button>
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setRejecting(false)}>Volver</Button>
        </form>
      )}
      {open && <p className="text-right text-xs text-muted-foreground">Pasar a pedido arma un pedido en borrador con estos precios; el stock se reserva al confirmarlo.</p>}
      {error && <p className="text-right text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Texto para pegar en WhatsApp: productos, total y validez. */
function whatsappText(q: QuoteDetail, company: string, vat: boolean) {
  const lines = q.lines.map((l) => `• ${number(l.quantity)} × ${l.description}${l.discountPct ? ` (−${number(l.discountPct)} %)` : ''}: ${money(l.lineTotal)}`);
  const total = vat && q.withInvoice ? `Total: ${money(q.grandTotal)} (IVA incluido)` : `Total: ${money(q.grandTotal)}`;
  return [
    `*Presupuesto ${q.number}*${company ? ` · ${company}` : ''}`,
    '',
    ...lines,
    '',
    `*${total}*`,
    ...(q.validUntil ? [`Válido hasta el ${day(q.validUntil)}.`] : []),
    ...(q.notes ? ['', q.notes] : []),
  ].join('\n');
}

function Lines({ quote }: { quote: QuoteDetail }) {
  const { data: fiscal } = useInvoicingStatus();
  const showVat = fiscal?.taxCondition === 'RESPONSABLE_INSCRIPTO' || quote.taxTotal > 0;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Producto</th>
            <th className="px-4 py-3 text-right font-medium">Cantidad</th>
            <th className="px-4 py-3 text-right font-medium">Precio</th>
            <th className="px-4 py-3 text-right font-medium">Desc.</th>
            <th className="px-4 py-3 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((l) => (
            <tr key={l.id} className="border-b last:border-0">
              <td className="px-4 py-2.5">
                <div>{l.description}</div>
                <div className="font-mono text-xs text-muted-foreground">{l.sku}</div>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{number(l.quantity)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{money(l.unitPrice)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{l.discountPct ? `${number(l.discountPct)} %` : '—'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t text-sm">
          {!!quote.discountTotal && <tr><td colSpan={5} className="px-4 pt-3 text-right text-muted-foreground">Descuentos − {money(quote.discountTotal)}</td></tr>}
          {showVat && (
            <>
              <tr><td colSpan={5} className="px-4 pt-3 text-right text-muted-foreground">Total sin IVA {money(quote.total)}</td></tr>
              <tr><td colSpan={5} className="px-4 pt-1 text-right text-muted-foreground">{quote.withInvoice ? `IVA 21 % ${money(quote.taxTotal)}` : 'Sin factura: no lleva IVA'}</td></tr>
            </>
          )}
          <tr><td colSpan={5} className="px-4 py-3 text-right text-base font-semibold">Total {money(quote.grandTotal)}</td></tr>
          {quote.marginTotal != null && <tr className="print:hidden"><td colSpan={5} className="px-4 pb-3 text-right text-muted-foreground">Margen {money(quote.marginTotal)}</td></tr>}
        </tfoot>
      </table>
    </Card>
  );
}

function EditQuote({ quote, onDone }: { quote: QuoteDetail; onDone: () => void }) {
  const update = useUpdateQuote(quote.id);
  const left = quote.validUntil ? Math.max(1, Math.round((Date.parse(quote.validUntil.slice(0, 10)) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000)) : 15;
  return (
    <>
      <OrderForm
        quote
        lockCustomer
        initial={{
          customer: { id: quote.customer.id, name: quote.customer.tradeName ?? quote.customer.legalName },
          withInvoice: quote.withInvoice,
          validDays: String(quote.status === 'EXPIRED' ? 15 : Math.min(90, left)),
          notes: quote.notes ?? '',
          lines: quote.lines.map((l) => ({
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
          { label: 'Descartar cambios', variant: 'outline', onSubmit: onDone },
          {
            label: 'Guardar cambios',
            onSubmit: (d) =>
              update.mutate(
                { version: quote.version, withInvoice: d.withInvoice, validDays: d.validDays, notes: d.notes ?? '', lines: d.lines },
                { onSuccess: onDone },
              ),
          },
        ]}
      />
    </>
  );
}
