'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { date } from '@/lib/utils';
import { useCustomers } from '@/lib/hooks';

const STATUS_TONE = { ACTIVE: 'good', PROSPECT: 'brand', INACTIVE: 'neutral', BLOCKED: 'bad' } as const;
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Activo', PROSPECT: 'Prospecto', INACTIVE: 'Inactivo', BLOCKED: 'Bloqueado' };

export default function CustomersPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useCustomers(q, page);
  const pages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Clientes</h1>
        <span className="text-sm text-muted-foreground">{data?.total ?? '…'} en total</span>
        <Button className="ml-auto" size="sm">
          <Plus className="h-4 w-4" /> Nuevo cliente
        </Button>
      </div>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nombre, CUIT o código" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Rubro</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Última compra</th>
              <th className="px-4 py-3 text-right font-medium">Riesgo</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b">
                  <td className="px-4 py-3" colSpan={5}><Skeleton className="h-5 w-full" /></td>
                </tr>
              ))}
            {data?.items.map((c) => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50">
                <td className="px-4 py-3">
                  <Link href={`/customers/${c.id}`} className="font-medium hover:underline">{c.tradeName ?? c.legalName}</Link>
                  <div className="text-xs text-muted-foreground">{c.code}</div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{c.industry ?? '—'}</td>
                <td className="px-4 py-3"><Badge tone={STATUS_TONE[c.status as keyof typeof STATUS_TONE] ?? 'neutral'}>{STATUS_LABEL[c.status] ?? c.status}</Badge></td>
                <td className="px-4 py-3 tabular-nums">{date(c.lastOrderAt)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {c.riskScore == null ? '—' : <Badge tone={c.riskScore >= 70 ? 'bad' : c.riskScore >= 45 ? 'warn' : 'good'}>{c.riskScore}</Badge>}
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No hay clientes que coincidan.</td></tr>
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
