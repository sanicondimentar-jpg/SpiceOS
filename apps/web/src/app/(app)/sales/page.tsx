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
import { QUOTE_STATUS_LABEL, QUOTE_STATUS_TONE, day, useQuotes, type QuoteStatus } from '@/lib/sales';
import { cn, date, money } from '@/lib/utils';

const FILTERS: { key: QuoteStatus | ''; label: string }[] = [
  { key: '', label: 'Todos' },
  { key: 'DRAFT', label: 'Borradores' },
  { key: 'SENT', label: 'Enviados' },
  { key: 'PENDING_APPROVAL', label: 'Falta aprobar' },
  { key: 'EXPIRED', label: 'Vencidos' },
  { key: 'ACCEPTED', label: 'Pasados a pedido' },
  { key: 'REJECTED', label: 'Rechazados' },
];

export default function SalesPage() {
  const { data: me } = useMe();
  const [status, setStatus] = useState<QuoteStatus | ''>('');
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuotes(status, q);
  const canWrite = !!me?.permissions.includes('sales.quote.write');
  const canRead = !!me?.permissions.includes('sales.quote.read');

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Ventas</h1>
        {canWrite && (
          <Button asChild className="ml-auto">
            <Link href="/sales/quotes/new"><Plus className="h-4 w-4" /> Nuevo presupuesto</Link>
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Presupuestos para clientes que todavía no confirmaron. Cuando el cliente acepta, se pasa a pedido con un clic y se respetan los precios presupuestados.
      </p>

      {!canRead && me && <p className="text-sm text-muted-foreground">Tu usuario no tiene permiso para ver presupuestos.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por cliente o número" aria-label="Buscar presupuestos" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Estado">
          {FILTERS.map((f) => (
            <button
              key={f.key || 'all'}
              type="button"
              aria-pressed={status === f.key}
              onClick={() => setStatus(f.key)}
              className={cn('rounded-full border px-3 py-1 text-xs', status === f.key ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Presupuesto</th>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Válido hasta</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Pedido</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-4"><Skeleton className="h-24" /></td></tr>}
            {data?.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/sales/quotes/${r.id}`} className="font-mono text-xs font-medium hover:underline">{r.number}</Link>
                    <Badge tone={QUOTE_STATUS_TONE[r.status]}>{QUOTE_STATUS_LABEL[r.status]}</Badge>
                  </div>
                </td>
                <td className="px-4 py-2.5"><Link href={`/sales/quotes/${r.id}`} className="hover:underline">{r.customer}</Link></td>
                <td className="px-4 py-2.5">{date(r.createdAt)}</td>
                <td className="px-4 py-2.5">{r.validUntil ? day(r.validUntil) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(r.grandTotal)}</td>
                <td className="px-4 py-2.5">{r.order ? <Link href={`/orders/${r.order.id}`} className="font-mono text-xs hover:underline">{r.order.number}</Link> : '—'}</td>
              </tr>
            ))}
            {data && !data.length && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{status || q ? 'No hay presupuestos con ese filtro.' : 'Todavía no hay presupuestos.'}</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
