'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useProducts } from '@/lib/catalog';
import { optNumber, optText } from '@/lib/form';
import { useMe } from '@/lib/hooks';
import { useReceiveStock, useWarehouses } from '@/lib/inventory';
import { money } from '@/lib/utils';

interface Line {
  variantId: string;
  sku: string;
  description: string;
  cost: number | null;
  quantity: string;
  lotCode: string;
  expiresAt: string;
  unitCost: string;
}

/** Ingreso de mercadería con lote y vencimiento por renglón. */
export default function ReceivePage() {
  const router = useRouter();
  const { data: warehouses } = useWarehouses();
  const { data: me } = useMe();
  const canSeeCost = !!me?.permissions.includes('catalog.cost.read');
  const receive = useReceiveStock();
  const [warehouseId, setWarehouseId] = useState('');
  const [reference, setReference] = useState('');
  const [updateCost, setUpdateCost] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!warehouseId && warehouses?.length) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);

  const update = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const submit = () => {
    setError(null);
    const out = [];
    for (const l of lines) {
      const quantity = optNumber(l.quantity);
      const unitCost = optNumber(l.unitCost);
      if (quantity === undefined || Number.isNaN(quantity) || quantity <= 0) return setError(`Cantidad inválida en ${l.sku}`);
      if (unitCost !== undefined && (Number.isNaN(unitCost) || unitCost < 0)) return setError(`Costo inválido en ${l.sku}`);
      out.push({ variantId: l.variantId, quantity, lotCode: optText(l.lotCode), expiresAt: optText(l.expiresAt), unitCost });
    }
    receive.mutate(
      { warehouseId, reference: optText(reference), updateCost, lines: out },
      { onSuccess: () => router.push('/inventory'), onError: (e) => setError(e.message) },
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Ingreso de mercadería</h1>
        <Link href="/inventory" className="ml-auto text-sm text-muted-foreground hover:underline">Volver a inventario</Link>
      </div>
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Depósito" htmlFor="warehouse">
            <Select id="warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Remito o factura del proveedor" htmlFor="reference">
            <Input id="reference" value={reference} placeholder="0001-00012345" onChange={(e) => setReference(e.target.value)} />
          </Field>
          {canSeeCost && (
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
              Actualizar el costo de los productos con el de este ingreso
            </label>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3 p-4">
          <h2 className="font-semibold">Productos recibidos</h2>
          <VariantSearch onPick={(v) => !lines.some((l) => l.variantId === v.variantId) && setLines([...lines, { ...v, quantity: '', lotCode: '', expiresAt: '', unitCost: '' }])} />
        </div>
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-y text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-4 py-2 text-right font-medium">Cantidad</th>
              <th className="px-4 py-2 font-medium">Lote</th>
              <th className="px-4 py-2 font-medium">Vencimiento</th>
              {canSeeCost && <th className="px-4 py-2 text-right font-medium">Costo unitario</th>}
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Agregá los productos del remito.</td></tr>}
            {lines.map((l, i) => (
              <tr key={l.variantId} className="border-b last:border-0">
                <td className="px-4 py-2">
                  <div>{l.description}</div>
                  <div className="font-mono text-xs text-muted-foreground">{l.sku}</div>
                </td>
                <td className="px-4 py-2 text-right">
                  <Input aria-label={`Cantidad de ${l.sku}`} className="ml-auto h-8 w-24 text-right" inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                </td>
                <td className="px-4 py-2">
                  <Input aria-label={`Lote de ${l.sku}`} className="h-8 w-36" placeholder="opcional" value={l.lotCode} onChange={(e) => update(i, { lotCode: e.target.value })} />
                </td>
                <td className="px-4 py-2">
                  <Input aria-label={`Vencimiento de ${l.sku}`} className="h-8 w-40" type="date" value={l.expiresAt} onChange={(e) => update(i, { expiresAt: e.target.value })} />
                </td>
                {canSeeCost && (
                  <td className="px-4 py-2 text-right">
                    <Input
                      aria-label={`Costo de ${l.sku}`}
                      className="ml-auto h-8 w-28 text-right"
                      inputMode="decimal"
                      placeholder={l.cost != null ? money(l.cost) : ''}
                      value={l.unitCost}
                      onChange={(e) => update(i, { unitCost: e.target.value })}
                    />
                  </td>
                )}
                <td className="px-2 py-2">
                  <Button variant="ghost" size="icon" aria-label={`Quitar ${l.sku}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && <p className="mr-auto text-sm text-destructive">{error}</p>}
        <Button disabled={!lines.length || !warehouseId || receive.isPending} onClick={submit}>{receive.isPending ? 'Guardando…' : `Registrar ingreso (${lines.length})`}</Button>
      </div>
    </div>
  );
}

function VariantSearch({ onPick }: { onPick: (v: { variantId: string; sku: string; description: string; cost: number | null }) => void }) {
  const [q, setQ] = useState('');
  const { data } = useProducts(q, 1);
  const options = q.length >= 2 ? data?.items.flatMap((p) => p.variants.map((v) => ({ p, v }))).slice(0, 30) : [];
  return (
    <div className="relative ml-auto w-full max-w-md">
      <Plus className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input className="pl-9" placeholder="Agregar producto: nombre o SKU" aria-label="Agregar producto" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {!!options?.length && (
        <ul className="absolute right-0 z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-card shadow-lg">
          {options.map(({ p, v }) => (
            <li key={v.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => { onPick({ variantId: v.id, sku: v.sku, description: `${p.name} ${v.name}`, cost: v.currentCost ?? null }); setQ(''); }}
              >
                <span className="flex-1">{p.name} <span className="text-muted-foreground">{v.name}</span></span>
                <Badge className="font-mono">{v.sku}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
