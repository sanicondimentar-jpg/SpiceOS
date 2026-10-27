'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, History, PackageOpen, PackagePlus, Search, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/hooks';
import { optNumber } from '@/lib/form';
import { useAdjustStock, useBreakPack, useStock, useVariantStock, useWarehouses, type StockRow } from '@/lib/inventory';
import { cn, date, money, number } from '@/lib/utils';

export default function InventoryPage() {
  const { data: warehouses } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [breaking, setBreaking] = useState(false);
  const { data, isLoading } = useStock({ warehouseId: warehouseId || undefined, q, onlyLow });
  const { data: me } = useMe();
  const canAdjust = !!me?.permissions.includes('inventory.stock.adjust');
  const canSeeCost = !!me?.permissions.includes('catalog.cost.read');
  const totalValue = data?.reduce((s, r) => s + (r.value ?? 0), 0) ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Inventario</h1>
        {canSeeCost && data && <span className="text-sm text-muted-foreground">Valorizado a costo: {money(totalValue)}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/inventory/movements"><History className="h-4 w-4" /> Movimientos</Link></Button>
          {canAdjust && (
            <>
              <Button asChild variant="outline" size="sm"><Link href="/imports?kind=stock"><Upload className="h-4 w-4" /> Cargar stock inicial</Link></Button>
              <Button variant="outline" size="sm" onClick={() => setBreaking((v) => !v)}><PackageOpen className="h-4 w-4" /> Abrir cajas</Button>
              <Button asChild size="sm"><Link href="/inventory/receive"><PackagePlus className="h-4 w-4" /> Ingreso de mercadería</Link></Button>
            </>
          )}
        </div>
      </div>

      {breaking && warehouses && <BreakPack warehouses={warehouses} defaultWarehouse={warehouseId || warehouses[0]?.id} onClose={() => setBreaking(false)} />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por producto o SKU" aria-label="Buscar en inventario" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {warehouses && warehouses.length > 1 && (
          <Select aria-label="Depósito" className="w-56" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Todos los depósitos</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Solo para reponer
        </label>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-3" />
              <th className="px-4 py-3 font-medium">Producto</th>
              <th className="px-4 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 text-right font-medium">Existente</th>
              <th className="px-4 py-3 text-right font-medium">Reservado</th>
              <th className="px-4 py-3 text-right font-medium">Disponible</th>
              <th className="px-4 py-3 font-medium">Próximo vencimiento</th>
              {canSeeCost && <th className="px-4 py-3 text-right font-medium">Valor</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => <tr key={i} className="border-b"><td colSpan={8} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>)}
            {data?.map((r) => (
              <Fragment key={r.variantId}>
                <tr className={cn('cursor-pointer border-b hover:bg-accent/40', open === r.variantId && 'bg-accent/30')} onClick={() => setOpen(open === r.variantId ? null : r.variantId)}>
                  <td className="px-2 py-2 text-muted-foreground">{open === r.variantId ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.sku}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{number(r.onHand)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.reserved ? number(r.reserved) : '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <span className="tabular-nums">{number(r.available)}</span>
                    {r.low && <Badge tone={r.available <= 0 ? 'bad' : 'warn'} className="ml-2">{r.available <= 0 ? 'sin stock' : 'reponer'}</Badge>}
                  </td>
                  <td className="px-4 py-2"><Expiry value={r.nextExpiry} /></td>
                  {canSeeCost && <td className="px-4 py-2 text-right tabular-nums">{money(r.value)}</td>}
                </tr>
                {open === r.variantId && (
                  <tr className="border-b bg-muted/30">
                    <td colSpan={8} className="px-6 py-3"><Lots row={r} canAdjust={canAdjust} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
            {data?.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">{onlyLow ? 'No hay productos para reponer.' : 'Sin resultados.'}</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Expiry({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const days = (new Date(value).getTime() - Date.now()) / 864e5;
  return <Badge tone={days < 0 ? 'bad' : days < 60 ? 'warn' : 'neutral'}>{days < 0 ? 'vencido' : date(value)}</Badge>;
}

/** Saldos por lote de una presentación, con ajuste o conteo por lote. */
function Lots({ row, canAdjust }: { row: StockRow; canAdjust: boolean }) {
  const { data, isLoading } = useVariantStock(row.variantId);
  const adjust = useAdjustStock();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ mode: 'count' as 'count' | 'delta' | 'waste', quantity: '', reason: '' });
  if (isLoading || !data) return <Skeleton className="h-10 w-full" />;
  if (!data.lots.length) return <p className="text-sm text-muted-foreground">Sin stock. <Link className="underline" href="/inventory/receive">Registrar un ingreso</Link></p>;

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">Lote</th>
            <th className="py-1 font-medium">Vence</th>
            <th className="py-1 font-medium">Depósito</th>
            <th className="py-1 text-right font-medium">Existente</th>
            <th className="py-1 text-right font-medium">Reservado</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {data.lots.map((l) => (
            <Fragment key={l.stockItemId}>
              <tr>
                <td className="py-1 font-mono text-xs">{l.lot ?? 'sin lote'}</td>
                <td className="py-1"><Expiry value={l.expiresAt} /></td>
                <td className="py-1">{l.warehouse}</td>
                <td className="py-1 text-right tabular-nums">{number(l.onHand)}</td>
                <td className="py-1 text-right tabular-nums">{l.reserved ? number(l.reserved) : '—'}</td>
                <td className="py-1 text-right">
                  {canAdjust && editing !== l.stockItemId && (
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditing(l.stockItemId); setForm({ mode: 'count', quantity: String(l.onHand), reason: '' }); adjust.reset(); }}>Ajustar</Button>
                  )}
                </td>
              </tr>
              {editing === l.stockItemId && (
                <tr>
                  <td colSpan={6} className="py-2">
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const n = optNumber(form.quantity);
                        if (n === undefined || Number.isNaN(n)) return;
                        adjust.mutate(
                          {
                            warehouseId: l.warehouseId,
                            variantId: row.variantId,
                            lotId: l.lotId,
                            type: form.mode === 'waste' ? 'WASTE' : 'ADJUSTMENT',
                            mode: form.mode === 'count' ? 'count' : 'delta',
                            quantity: form.mode === 'waste' ? -Math.abs(n) : n,
                            reason: form.reason,
                          },
                          { onSuccess: () => setEditing(null) },
                        );
                      }}
                    >
                      <Field label="Tipo" htmlFor="adj-mode">
                        <Select id="adj-mode" className="w-44" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as typeof form.mode, quantity: e.target.value === 'count' ? String(l.onHand) : '' })}>
                          <option value="count">Conteo (cantidad real)</option>
                          <option value="delta">Ajuste (+ / −)</option>
                          <option value="waste">Merma (roto, vencido)</option>
                        </Select>
                      </Field>
                      <Field label={form.mode === 'count' ? 'Contado' : 'Cantidad'} htmlFor="adj-qty">
                        <Input id="adj-qty" className="w-28 text-right" inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                      </Field>
                      <Field label="Motivo" htmlFor="adj-reason" className="min-w-48 flex-1">
                        <Input id="adj-reason" value={form.reason} placeholder="Conteo mensual, bolsa rota…" onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                      </Field>
                      <Button type="submit" size="sm" className="h-9" disabled={adjust.isPending || form.reason.trim().length < 3}>Guardar</Button>
                      <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setEditing(null)}>Cancelar</Button>
                      {adjust.error && <p className="w-full text-xs text-destructive">{adjust.error.message}</p>}
                    </form>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <Link href={`/inventory/movements?variantId=${row.variantId}`} className="text-xs text-muted-foreground underline">Ver movimientos de {row.sku}</Link>
    </div>
  );
}

/** Abrir cajas: la caja sale del stock y entran las unidades sueltas con el mismo lote. */
function BreakPack({ warehouses, defaultWarehouse, onClose }: { warehouses: { id: string; name: string }[]; defaultWarehouse?: string; onClose: () => void }) {
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse ?? '');
  const [fromQ, setFromQ] = useState('');
  const [from, setFrom] = useState<StockRow | null>(null);
  const [to, setTo] = useState<StockRow | null>(null);
  const [packs, setPacks] = useState('1');
  const [units, setUnits] = useState('');
  const breakPack = useBreakPack();
  const { data: boxes } = useStock({ warehouseId, q: fromQ, onlyLow: false });
  const { data: singles } = useStock({ warehouseId, q: from ? `${from.sku}-U` : '__', onlyLow: false });
  const pick = (row: StockRow) => {
    setFrom(row);
    // "Caja 50 sobres × 25 g" → 50 unidades por caja.
    setUnits(row.name.match(/(\d+)\s+(sobres|paquetes|frascos|cartones|unidades)/i)?.[1] ?? '');
    setTo(null);
  };
  const suggestedTo = to ?? singles?.find((s) => s.sku === `${from?.sku}-U`) ?? null;
  const p = Number(packs);
  const u = Number(units);

  return (
    <Card>
      <CardHeader className="flex-row items-center">
        <CardTitle>Abrir cajas para vender sueltos</CardTitle>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>Cerrar</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Depósito" htmlFor="bp-wh">
            <Select id="bp-wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Caja que se abre" htmlFor="bp-from" className="lg:col-span-2">
            {from ? (
              <div id="bp-from" className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                <span className="truncate">{from.name}</span>
                <span className="text-xs text-muted-foreground">({number(from.available)} disp.)</span>
                <button type="button" className="ml-auto text-xs underline" onClick={() => setFrom(null)}>cambiar</button>
              </div>
            ) : (
              <div className="relative">
                <Input id="bp-from" placeholder="Buscar caja por nombre o SKU" value={fromQ} onChange={(e) => setFromQ(e.target.value)} autoComplete="off" />
                {fromQ.length >= 2 && (
                  <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-card shadow-lg">
                    {boxes?.filter((b) => b.available > 0 && !b.sku.endsWith('-U')).slice(0, 20).map((b) => (
                      <li key={b.variantId}>
                        <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => pick(b)}>
                          {b.name} <span className="font-mono text-xs text-muted-foreground">{b.sku} · {number(b.available)} disp.</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
          <Field label="Presentación suelta" htmlFor="bp-to">
            <div id="bp-to" className={cn('flex h-9 items-center rounded-md border px-3 text-sm', !suggestedTo && 'text-muted-foreground')}>
              {suggestedTo ? `${suggestedTo.sku}` : from ? `No existe ${from.sku}-U` : 'Elegí la caja'}
            </div>
          </Field>
          <Field label="Cajas a abrir" htmlFor="bp-packs">
            <Input id="bp-packs" inputMode="numeric" value={packs} onChange={(e) => setPacks(e.target.value)} />
          </Field>
          <Field label="Unidades por caja" htmlFor="bp-units">
            <Input id="bp-units" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!from || !suggestedTo || !(p > 0) || !(u > 0) || breakPack.isPending}
            onClick={() =>
              breakPack.mutate(
                { warehouseId, fromVariantId: from!.variantId, toVariantId: suggestedTo!.variantId, packs: p, unitsPerPack: u },
                { onSuccess: () => { setFrom(null); setFromQ(''); } },
              )
            }
          >
            {from && p > 0 && u > 0 ? `Abrir ${p} y sumar ${p * u} sueltos` : 'Abrir cajas'}
          </Button>
          {breakPack.data && !from && <p className="text-sm text-success">Listo: entraron {number(breakPack.data.units)} unidades sueltas.</p>}
          {breakPack.error && <p className="text-sm text-destructive">{breakPack.error.message}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
