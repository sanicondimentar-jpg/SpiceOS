'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MOVEMENT_LABEL, useMovements } from '@/lib/inventory';
import { cn, number } from '@/lib/utils';

export default function MovementsPage() {
  return (
    <Suspense>
      <Movements />
    </Suspense>
  );
}

function Movements() {
  const variantId = useSearchParams().get('variantId') ?? undefined;
  const { data, isLoading } = useMovements({ variantId, limit: 300 });

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Movimientos de stock</h1>
        {variantId && data?.[0] && <span className="text-sm text-muted-foreground">{data[0].name} · <Link href="/inventory/movements" className="underline">ver todos</Link></span>}
        <Link href="/inventory" className="ml-auto text-sm text-muted-foreground hover:underline">Volver a inventario</Link>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Producto</th>
              <th className="px-4 py-3 font-medium">Lote</th>
              <th className="px-4 py-3 text-right font-medium">Cantidad</th>
              <th className="px-4 py-3 font-medium">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => <tr key={i} className="border-b"><td colSpan={6} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>)}
            {data?.map((m) => (
              <tr key={m.id} className="border-b last:border-0">
                <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{new Date(m.occurredAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className="px-4 py-2">{MOVEMENT_LABEL[m.type] ?? m.type}</td>
                <td className="px-4 py-2">{m.name} <span className="font-mono text-xs text-muted-foreground">{m.sku}</span></td>
                <td className="px-4 py-2 font-mono text-xs">{m.lot ?? '—'}</td>
                <td className={cn('px-4 py-2 text-right font-medium tabular-nums', m.quantity < 0 ? 'text-destructive' : 'text-success')}>
                  {m.quantity > 0 && '+'}{number(m.quantity)}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {m.referenceType === 'sales_order' && m.referenceId ? <Link className="underline" href={`/orders/${m.referenceId}`}>Ver pedido</Link> : m.reason ?? '—'}
                </td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Todavía no hay movimientos.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
