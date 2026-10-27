'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/hooks';
import { CHANNEL_LABEL, STATUS_LABEL, STATUS_TONE, useOrders, type OrderStatus } from '@/lib/orders';
import { cn, date, money } from '@/lib/utils';

const TABS: (OrderStatus | undefined)[] = [undefined, 'DRAFT', 'CONFIRMED', 'PICKING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];

export default function OrdersPage() {
  const [status, setStatus] = useState<OrderStatus>();
  const [q, setQ] = useState('');
  const { data, isLoading } = useOrders({ status, q });
  const { data: me } = useMe();
  const canWrite = me?.permissions.includes('orders.order.write');

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Pedidos</h1>
        {canWrite && <Button asChild size="sm" className="ml-auto"><Link href="/orders/new"><Plus className="h-4 w-4" /> Nuevo pedido</Link></Button>}
      </div>
      <div role="tablist" aria-label="Estado" className="flex flex-wrap gap-2">
        {TABS.map((s) => (
          <button
            key={s ?? 'all'}
            role="tab"
            aria-selected={s === status}
            onClick={() => setStatus(s)}
            className={cn('rounded-full border px-3 py-1.5 text-sm', s === status ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-accent')}
          >
            {s ? STATUS_LABEL[s] : 'Todos'}
          </button>
        ))}
      </div>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por número o cliente" aria-label="Buscar pedidos" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Número</th>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Canal</th>
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Entrega</th>
              <th className="px-4 py-3 text-right font-medium">Total a cobrar</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 6 }).map((_, i) => <tr key={i} className="border-b"><td colSpan={7} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>)}
            {data?.map((o) => (
              <tr key={o.id} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-4 py-2.5"><Link href={`/orders/${o.id}`} className="font-mono text-xs font-medium hover:underline">{o.number}</Link></td>
                <td className="px-4 py-2.5"><Link href={`/customers/${o.customerId}`} className="hover:underline">{o.customer}</Link></td>
                <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></td>
                <td className="px-4 py-2.5 text-muted-foreground">{CHANNEL_LABEL[o.channel] ?? o.channel}</td>
                <td className="px-4 py-2.5">{date(o.createdAt)}</td>
                <td className="px-4 py-2.5">{date(o.requestedDate)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {money(o.grandTotal)}
                  {!o.withInvoice && <div className="text-xs text-muted-foreground">sin factura</div>}
                </td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No hay pedidos{status && ` ${STATUS_LABEL[status].toLowerCase()}s`}.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
