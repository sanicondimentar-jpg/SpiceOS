'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PO_STATUS_LABEL, PO_STATUS_TONE, usePurchaseOrders, type PurchaseOrderStatus } from '@/lib/purchasing';
import { cn, date, money } from '@/lib/utils';

const TABS: (PurchaseOrderStatus | undefined)[] = [undefined, 'DRAFT', 'SENT', 'RECEIVED', 'CANCELLED'];

export default function PurchasesPage() {
  const [status, setStatus] = useState<PurchaseOrderStatus>();
  const { data, isLoading } = usePurchaseOrders(status);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Notas de pedido a proveedores</h1>
        <Button asChild variant="outline" size="sm" className="ml-auto"><Link href="/purchases/suppliers">Proveedores</Link></Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Se arman solas: al confirmar un pedido sin stock suficiente, lo que falta se suma a la nota en borrador del proveedor de cada producto.
        Revisala, mandala y marcala como enviada.
      </p>
      <div role="tablist" aria-label="Estado" className="flex flex-wrap gap-2">
        {TABS.map((s) => (
          <button
            key={s ?? 'all'}
            role="tab"
            aria-selected={s === status}
            onClick={() => setStatus(s)}
            className={cn('rounded-full border px-3 py-1.5 text-sm', s === status ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-accent')}
          >
            {s ? PO_STATUS_LABEL[s] : 'Todas'}
          </button>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Número</th>
              <th className="px-4 py-3 font-medium">Proveedor</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Creada</th>
              <th className="px-4 py-3 font-medium">Enviada</th>
              <th className="px-4 py-3 text-right font-medium">Productos</th>
              <th className="px-4 py-3 text-right font-medium">Total (costo)</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 4 }).map((_, i) => <tr key={i} className="border-b"><td colSpan={7} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>)}
            {data?.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-4 py-2.5"><Link href={`/purchases/${p.id}`} className="font-mono text-xs font-medium hover:underline">{p.number}</Link></td>
                <td className="px-4 py-2.5">{p.supplier}</td>
                <td className="px-4 py-2.5"><Badge tone={PO_STATUS_TONE[p.status]}>{PO_STATUS_LABEL[p.status]}</Badge></td>
                <td className="px-4 py-2.5">{date(p.createdAt)}</td>
                <td className="px-4 py-2.5">{date(p.sentAt)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{p.lines}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(p.total)}</td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No hay notas de pedido{status && ` en estado ${PO_STATUS_LABEL[status].toLowerCase()}`}.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
