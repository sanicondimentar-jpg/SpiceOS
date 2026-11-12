'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Download, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { download } from '@/lib/api';
import { useMe } from '@/lib/hooks';
import { invoiceFilename, invoicePdfPath, useInvoices } from '@/lib/invoicing';
import { date, money } from '@/lib/utils';

/** Facturas y notas de crédito emitidas con ARCA desde los pedidos. */
export default function InvoicesPage() {
  const [q, setQ] = useState('');
  const { data, isLoading } = useInvoices(q);
  const { data: me } = useMe();
  const canSettings = me?.permissions.includes('core.settings.manage');

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Facturas</h1>
        {canSettings && <Link href="/settings/invoicing" className="ml-auto text-sm text-muted-foreground hover:underline">Configuración de facturación</Link>}
      </div>
      <p className="text-sm text-muted-foreground">Se factura desde cada pedido con el botón «Facturar». Para anular una factura, entrá al pedido.</p>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por cliente o CUIT" aria-label="Buscar facturas" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Comprobante</th>
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Pedido</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="p-4"><Skeleton className="h-24" /></td></tr>
            )}
            {data?.map((i) => (
              <tr key={i.id} className="border-b last:border-0">
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{i.label}</span>
                    <span className="font-mono text-xs">{i.number}</span>
                    {i.testing && <Badge tone="warn">Prueba</Badge>}
                    {i.status === 'CANCELLED' && <Badge tone="bad">Anulada</Badge>}
                  </div>
                </td>
                <td className="px-4 py-2.5">{date(i.issueDate)}</td>
                <td className="px-4 py-2.5">{i.receiverName}</td>
                <td className="px-4 py-2.5">{i.orderId ? <Link href={`/orders/${i.orderId}`} className="font-mono text-xs hover:underline">{i.orderNumber ?? 'ver'}</Link> : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{i.type.startsWith('NC') ? '− ' : ''}{money(i.total)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button size="sm" variant="ghost" aria-label={`Descargar ${i.label} ${i.number}`} onClick={() => void download(invoicePdfPath(i.id), invoiceFilename(i))}>
                    <Download className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Todavía no hay facturas.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
