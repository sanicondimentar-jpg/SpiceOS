'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { usePriceListItems, usePriceLists, useReprice, useUpsertPrices, type RepriceChange } from '@/lib/catalog';
import { optNumber } from '@/lib/form';
import { useMe } from '@/lib/hooks';
import { cn, money, number } from '@/lib/utils';

export default function PriceListsPage() {
  const { data: lists } = usePriceLists();
  const [listId, setListId] = useState<string>();
  useEffect(() => {
    if (!listId && lists?.length) setListId(lists.find((l) => l.isDefault)?.id ?? lists[0].id);
  }, [lists, listId]);
  const { data: me } = useMe();
  const canWrite = !!me?.permissions.includes('catalog.product.write');
  const canSeeCost = !!me?.permissions.includes('catalog.cost.read');

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <h1 className="text-2xl font-semibold">Listas de precios</h1>
      <div role="tablist" aria-label="Listas de precios" className="flex flex-wrap gap-2">
        {lists?.map((l) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={l.id === listId}
            onClick={() => setListId(l.id)}
            className={cn('rounded-full border px-3 py-1.5 text-sm', l.id === listId ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-accent')}
          >
            {l.name} <span className="text-xs text-muted-foreground">· {l._count.items} precios · {l._count.customers} clientes{l.isDefault && ' · por defecto'}</span>
          </button>
        ))}
      </div>
      {listId && canWrite && canSeeCost && <RepricePanel listId={listId} />}
      {listId && <ItemsTable listId={listId} canWrite={canWrite} canSeeCost={canSeeCost} />}
    </div>
  );
}

function ItemsTable({ listId, canWrite, canSeeCost }: { listId: string; canWrite: boolean; canSeeCost: boolean }) {
  const { data, isLoading } = usePriceListItems(listId);
  const save = useUpsertPrices(listId);
  const [q, setQ] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => setEdits({}), [listId]);
  const key = (variantId: string, minQuantity: number) => `${variantId}:${minQuantity}`;
  const rows = useMemo(
    () => data?.items.filter((i) => !q || `${i.sku} ${i.name}`.toLowerCase().includes(q.toLowerCase())) ?? [],
    [data, q],
  );
  const dirty = Object.entries(edits).filter(([, v]) => optNumber(v) !== undefined && !Number.isNaN(optNumber(v)));

  const submit = async () => {
    const items = dirty.map(([k, v]) => {
      const [variantId, minQuantity] = k.split(':');
      return { variantId, minQuantity: Number(minQuantity), price: optNumber(v)! };
    });
    const res = await save.mutateAsync({ items });
    setWarnings(res.warnings);
    setEdits({});
  };

  return (
    <Card className="overflow-x-auto">
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle>Precios {data?.includesTax ? 'con IVA' : 'sin IVA'}</CardTitle>
        <Input className="h-8 max-w-xs" placeholder="Filtrar por SKU o nombre" aria-label="Filtrar precios" value={q} onChange={(e) => setQ(e.target.value)} />
        {canWrite && (
          <Button size="sm" className="ml-auto" disabled={!dirty.length || save.isPending} onClick={submit}>
            {save.isPending ? 'Guardando…' : `Guardar ${dirty.length || ''} cambios`}
          </Button>
        )}
      </CardHeader>
      {warnings.length > 0 && (
        <div className="mx-5 mb-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-medium">Guardado, pero hay precios debajo del margen mínimo:</p>
          <ul className="list-disc pl-5">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {save.error && <p className="mx-5 mb-3 text-sm text-destructive">{save.error.message}</p>}
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-y text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Producto</th>
            <th className="px-4 py-2 font-medium">SKU</th>
            <th className="px-4 py-2 text-right font-medium">Desde</th>
            {canSeeCost && <th className="px-4 py-2 text-right font-medium">Costo</th>}
            <th className="px-4 py-2 text-right font-medium">Precio</th>
            {canSeeCost && <th className="px-4 py-2 text-right font-medium">Margen</th>}
          </tr>
        </thead>
        <tbody>
          {isLoading && <tr><td colSpan={6} className="p-4"><Skeleton className="h-24 w-full" /></td></tr>}
          {rows.map((i) => {
            const k = key(i.variantId, i.minQuantity);
            return (
              <tr key={k} className="border-b last:border-0">
                <td className="px-4 py-2">{i.name}</td>
                <td className="px-4 py-2 font-mono text-xs">{i.sku}</td>
                <td className="px-4 py-2 text-right tabular-nums">{number(i.minQuantity)}</td>
                {canSeeCost && <td className="px-4 py-2 text-right tabular-nums">{money(i.cost)}</td>}
                <td className="px-4 py-2 text-right">
                  {canWrite ? (
                    <Input
                      aria-label={`Precio de ${i.sku} desde ${i.minQuantity}`}
                      className={cn('ml-auto h-8 w-32 text-right tabular-nums', k in edits && 'border-primary')}
                      inputMode="decimal"
                      value={edits[k] ?? String(i.price)}
                      onChange={(e) => setEdits({ ...edits, [k]: e.target.value })}
                    />
                  ) : (
                    <span className="tabular-nums">{money(i.price)}</span>
                  )}
                </td>
                {canSeeCost && (
                  <td className="px-4 py-2 text-right">
                    {i.marginPct == null ? '—' : <Badge tone={i.belowMinMargin ? 'bad' : 'neutral'}>{number(i.marginPct)} %</Badge>}
                  </td>
                )}
              </tr>
            );
          })}
          {data && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No hay precios cargados en esta lista.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

/** Recalcular la lista como costo × factor: primero vista previa, después aplicar. */
function RepricePanel({ listId }: { listId: string }) {
  const reprice = useReprice(listId);
  const [factor, setFactor] = useState('1,55');
  const [roundTo, setRoundTo] = useState('10');
  const [preview, setPreview] = useState<RepriceChange[] | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  useEffect(() => { setPreview(null); setApplied(null); }, [listId]);
  const f = optNumber(factor);
  const r = optNumber(roundTo);
  const valid = f !== undefined && !Number.isNaN(f) && f >= 1 && r !== undefined && !Number.isNaN(r) && r > 0;

  const run = async (dryRun: boolean) => {
    if (!valid) return;
    const res = await reprice.mutateAsync({ factor: f!, roundTo: r!, dryRun });
    if (dryRun) { setPreview(res.changes); setApplied(null); } else { setPreview(null); setApplied(res.changes.length); }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Recalcular desde el costo</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Factor sobre costo" htmlFor="factor" hint="1,55 = costo + 55 %">
            <Input id="factor" className="w-32" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} />
          </Field>
          <Field label="Redondear a múltiplos de" htmlFor="roundTo">
            <Input id="roundTo" className="w-32" inputMode="decimal" value={roundTo} onChange={(e) => setRoundTo(e.target.value)} />
          </Field>
          <Button variant="outline" disabled={!valid || reprice.isPending} onClick={() => run(true)}>Ver cambios</Button>
          {preview && preview.length > 0 && (
            <Button disabled={reprice.isPending} onClick={() => run(false)}>Aplicar {preview.length} precios</Button>
          )}
        </div>
        {reprice.error && <p className="text-sm text-destructive">{reprice.error.message}</p>}
        {applied !== null && <p className="text-sm text-success">Se actualizaron {applied} precios.</p>}
        {preview && preview.length === 0 && <p className="text-sm text-muted-foreground">Con ese factor no cambia ningún precio.</p>}
        {preview && preview.length > 0 && (
          <div className="max-h-96 overflow-auto rounded-md border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Producto</th>
                  <th className="px-3 py-2 text-right font-medium">Costo</th>
                  <th className="px-3 py-2 text-right font-medium">Actual</th>
                  <th className="px-3 py-2 text-right font-medium">Nuevo</th>
                  <th className="px-3 py-2 text-right font-medium">Variación</th>
                  <th className="px-3 py-2 text-right font-medium">Margen</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((c) => (
                  <tr key={c.variantId} className="border-t">
                    <td className="px-3 py-1.5">{c.name} <span className="font-mono text-xs text-muted-foreground">{c.sku}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(c.cost)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{c.currentPrice == null ? '—' : money(c.currentPrice)}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{money(c.newPrice)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{c.changePct == null ? 'nuevo' : `${c.changePct > 0 ? '+' : ''}${number(c.changePct)} %`}</td>
                    <td className="px-3 py-1.5 text-right"><Badge tone={c.belowMinMargin ? 'bad' : 'neutral'}>{number(c.marginPct)} %</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
