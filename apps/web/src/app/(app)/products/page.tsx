'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, Search, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useProducts } from '@/lib/catalog';
import { useMe } from '@/lib/hooks';
import { money, number } from '@/lib/utils';

export default function ProductsPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useProducts(q, page);
  const { data: me } = useMe();
  const canWrite = me?.permissions.includes('catalog.product.write');
  const canSeeCost = me?.permissions.includes('catalog.cost.read');
  const pages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Productos</h1>
        <span className="text-sm text-muted-foreground">
          {data?.total ?? '…'} productos{data?.priceList && ` · precios de la lista ${data.priceList.name}`}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/price-lists">Listas de precios</Link></Button>
          {canWrite && (
            <>
              <Button asChild variant="outline" size="sm"><Link href="/imports?kind=products"><Upload className="h-4 w-4" /> Importar</Link></Button>
              <Button asChild size="sm"><Link href="/products/new"><Plus className="h-4 w-4" /> Nuevo producto</Link></Button>
            </>
          )}
        </div>
      </div>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nombre, código o SKU" aria-label="Buscar productos" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Producto</th>
              <th className="px-4 py-3 font-medium">Presentación</th>
              <th className="px-4 py-3 font-medium">SKU</th>
              {canSeeCost && <th className="px-4 py-3 text-right font-medium">Costo</th>}
              <th className="px-4 py-3 text-right font-medium">Precio</th>
              {canSeeCost && <th className="px-4 py-3 text-right font-medium">Margen</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b"><td className="px-4 py-3" colSpan={6}><Skeleton className="h-5 w-full" /></td></tr>
              ))}
            {data?.items.map((p) =>
              p.variants.map((v, i) => (
                <tr key={v.id} className={i === p.variants.length - 1 ? 'border-b last:border-0' : ''}>
                  {i === 0 && (
                    <td className="px-4 py-3 align-top" rowSpan={p.variants.length}>
                      <Link href={`/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                      <div className="text-xs text-muted-foreground">{p.code}{p.category && ` · ${p.category.name}`}</div>
                    </td>
                  )}
                  <td className="px-4 py-2">{v.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{v.sku}</td>
                  {canSeeCost && <td className="px-4 py-2 text-right tabular-nums">{money(v.currentCost)}</td>}
                  <td className="px-4 py-2 text-right tabular-nums">{v.listPrice == null ? <span className="text-muted-foreground">sin precio</span> : money(v.listPrice)}</td>
                  {canSeeCost && (
                    <td className="px-4 py-2 text-right tabular-nums">
                      {v.marginPct == null ? '—' : (
                        <Badge tone={v.marginPct < v.minMarginPct ? 'bad' : 'neutral'}>{number(v.marginPct)} %</Badge>
                      )}
                    </td>
                  )}
                </tr>
              )),
            )}
            {data && data.items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No hay productos que coincidan.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
        <span className="text-xs text-muted-foreground">Página {page} de {pages || 1}</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}
