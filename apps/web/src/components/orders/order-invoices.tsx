'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Download, Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { download } from '@/lib/api';
import { invoiceFilename, invoicePdfPath, useCreditNote, useInvoicingStatus, useIssueInvoice, useOrderInvoices, type InvoiceRow } from '@/lib/invoicing';
import type { OrderDetail } from '@/lib/orders';
import { date, money } from '@/lib/utils';

const INVOICEABLE = ['CONFIRMED', 'PICKING', 'READY', 'DISPATCHED', 'DELIVERED'];

/** Facturas del pedido: botón para pedir el CAE a ARCA, PDF y anulación con nota de crédito. */
export function OrderInvoices({ order, can }: { order: OrderDetail; can: (p: string) => boolean }) {
  const { data: invoices } = useOrderInvoices(order.id);
  const { data: status } = useInvoicingStatus();
  const issue = useIssueInvoice(order.id);
  const canIssue = can('invoicing.invoice.issue');
  const active = invoices?.find((i) => !i.type.startsWith('NC') && i.status !== 'CANCELLED');
  const showButton = canIssue && !active && INVOICEABLE.includes(order.status);
  if (!invoices || (!invoices.length && !showButton)) return null;

  return (
    <Card className="print:hidden">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
        <CardTitle className="mr-auto">Factura</CardTitle>
        {showButton &&
          (status?.ready ? (
            <Button
              size="sm"
              disabled={issue.isPending}
              onClick={() => {
                if (window.confirm(`¿Facturar ${money(order.grandTotal)} a ${order.customer.legalName}? La factura se pide a ARCA y no se puede borrar (solo anular con nota de crédito).`)) issue.mutate(undefined);
              }}
            >
              <Receipt className="h-4 w-4" /> {issue.isPending ? 'Pidiendo CAE a ARCA…' : status.testing ? 'Facturar (prueba)' : 'Facturar'}
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">
              Para facturar desde acá, completá <Link href="/settings/invoicing" className="underline">Configuración → Facturación</Link>.
            </span>
          ))}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {issue.error && <p className="text-destructive">{issue.error.message}</p>}
        {!order.customer.taxId && showButton && (
          <p className="text-muted-foreground">El cliente no tiene CUIT ni DNI cargado: la factura sale a «Consumidor final» sin identificar.</p>
        )}
        {invoices.map((i) => <InvoiceLine key={i.id} invoice={i} canCancel={canIssue} />)}
      </CardContent>
    </Card>
  );
}

function InvoiceLine({ invoice: i, canCancel }: { invoice: InvoiceRow; canCancel: boolean }) {
  const credit = useCreditNote();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [downloading, setDownloading] = useState(false);
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{i.label} {i.number}</span>
        {i.testing && <Badge tone="warn">Prueba</Badge>}
        {i.status === 'CANCELLED' && <Badge tone="bad">Anulada</Badge>}
        <span className="text-muted-foreground">· {date(i.issueDate)} · {money(i.total)} · CAE {i.cae}</span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={downloading}
            onClick={() => {
              setDownloading(true);
              void download(invoicePdfPath(i.id), invoiceFilename(i)).finally(() => setDownloading(false));
            }}
          >
            <Download className="h-4 w-4" /> PDF
          </Button>
          {canCancel && !i.type.startsWith('NC') && i.status !== 'CANCELLED' && !cancelling && (
            <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>Anular</Button>
          )}
        </div>
      </div>
      {cancelling && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            credit.mutate({ id: i.id, reason }, { onSuccess: () => setCancelling(false) });
          }}
        >
          <Input autoFocus aria-label="Motivo" placeholder="Motivo (se emite una nota de crédito por el total)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" size="sm" variant="destructive" className="h-9" disabled={reason.trim().length < 3 || credit.isPending}>
            {credit.isPending ? 'Pidiendo CAE…' : 'Emitir nota de crédito'}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => setCancelling(false)}>Volver</Button>
        </form>
      )}
      {credit.error && <p className="text-destructive">{credit.error.message}</p>}
    </div>
  );
}
