'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { day, useSupplierAccounts } from '@/lib/supplier-accounts';
import { money } from '@/lib/utils';

/** Cuánto se le debe a cada proveedor. */
export default function SupplierPaymentsPage() {
  const { data, isLoading, error } = useSupplierAccounts();
  const total = data?.reduce((s, a) => s + Math.max(0, a.balance), 0) ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/purchases" className="text-sm text-muted-foreground hover:underline">← Compras</Link>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">Pagos a proveedores</h1>
        {!!data?.length && <span className="ml-auto text-sm text-muted-foreground">Total a pagar <span className="text-lg font-semibold text-foreground">{money(total)}</span></span>}
      </div>
      <p className="text-sm text-muted-foreground">
        Cada ingreso de mercadería con proveedor queda como compra a pagar. Entrá al proveedor para registrar un pago con su comprobante: un mismo pago puede cubrir varias compras.
      </p>
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Proveedor</th>
              <th className="px-4 py-3 text-right font-medium">Comprado</th>
              <th className="px-4 py-3 text-right font-medium">Pagado</th>
              <th className="px-4 py-3 text-right font-medium">Saldo</th>
              <th className="px-4 py-3 font-medium">Último pago</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 2 }).map((_, i) => <tr key={i} className="border-b"><td colSpan={5} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>)}
            {data?.map((a) => (
              <tr key={a.supplierId} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-4 py-2.5">
                  <Link href={`/purchases/payments/${a.supplierId}`} className="font-medium hover:underline">{a.name}</Link>
                  {a.unpaidPurchases > 0 && <Badge tone="warn" className="ml-2">{a.unpaidPurchases} {a.unpaidPurchases === 1 ? 'compra' : 'compras'} a pagar</Badge>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(a.purchased)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(a.paid)}</td>
                <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${a.balance > 0.005 ? 'text-warning' : ''}`}>
                  {a.balance < -0.005 ? `${money(-a.balance)} a favor` : money(a.balance)}
                </td>
                <td className="px-4 py-2.5">{day(a.lastPaymentAt)}</td>
              </tr>
            ))}
            {data?.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No hay proveedores.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
