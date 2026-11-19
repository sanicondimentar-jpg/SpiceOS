'use client';

import Link from 'next/link';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { download } from '@/lib/api';
import { useCustomerInvoices } from '@/lib/crm';
import { invoiceFilename, invoicePdfPath, type InvoiceRow } from '@/lib/invoicing';
import { STATUS_LABEL, STATUS_TONE, useOrders } from '@/lib/orders';
import { date, money } from '@/lib/utils';

/**
 * Historial de pedidos del cliente con la factura de cada uno, si se facturó.
 * Facturar es opcional: un pedido sin factura no es un error.
 */
export function CustomerOrdersCard({ customerId, canSeeInvoices }: { customerId: string; canSeeInvoices: boolean }) {
  const { data: orders, isLoading } = useOrders({ q: '', customerId });
  const { data: invoices } = useCustomerInvoices(customerId);

  const byOrder = new Map<string, InvoiceRow[]>();
  for (const i of invoices ?? []) {
    if (!i.orderId) continue;
    byOrder.set(i.orderId, [...(byOrder.get(i.orderId) ?? []), i]);
  }
  const valid = (i: InvoiceRow) => !i.type.startsWith('NC') && i.status !== 'CANCELLED' && !i.testing;
  const done = (orders ?? []).filter((o) => o.status !== 'DRAFT' && o.status !== 'CANCELLED');
  const invoiced = done.filter((o) => byOrder.get(o.id)?.some(valid));
  const invoicedTotal = invoiced.reduce((sum, o) => sum + (byOrder.get(o.id)?.find(valid)?.total ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-baseline gap-x-3">
        <CardTitle>Pedidos y facturas</CardTitle>
        {orders && (
          <span className="text-xs text-muted-foreground">
            {done.length} {done.length === 1 ? 'pedido' : 'pedidos'} · {invoiced.length} con factura ({money(invoicedTotal)}) · {done.length - invoiced.length} sin factura
          </span>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {isLoading && <Skeleton className="m-4 h-24" />}
        {orders && orders.length === 0 && <p className="px-5 pb-5 text-sm text-muted-foreground">Todavía no hizo pedidos.</p>}
        {orders && orders.length > 0 && (
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Pedido</th>
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 font-medium">Factura</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const docs = byOrder.get(o.id) ?? [];
                return (
                  <tr key={o.id} className="border-b last:border-0 align-top">
                    <td className="px-4 py-2"><Link href={`/orders/${o.id}`} className="font-mono text-xs hover:underline">{o.number}</Link></td>
                    <td className="px-4 py-2 tabular-nums">{date(o.createdAt)}</td>
                    <td className="px-4 py-2"><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(o.grandTotal ?? o.total)}</td>
                    <td className="px-4 py-2">
                      {docs.length === 0 && <span className="text-muted-foreground">Sin factura</span>}
                      <div className="space-y-1">
                        {docs.map((i) => (
                          <div key={i.id} className="flex flex-wrap items-center gap-1.5">
                            <span className={i.status === 'CANCELLED' ? 'line-through text-muted-foreground' : undefined}>{i.label} {i.number}</span>
                            {i.testing && <Badge tone="warn">Prueba</Badge>}
                            {i.status === 'CANCELLED' && <Badge tone="bad">Anulada</Badge>}
                            {canSeeInvoices && (
                              <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Descargar ${i.label} ${i.number}`} onClick={() => void download(invoicePdfPath(i.id), invoiceFilename(i))}>
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
