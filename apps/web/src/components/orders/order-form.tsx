'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useProducts } from '@/lib/catalog';
import { optNumber, optText } from '@/lib/form';
import { useCustomers, useMe } from '@/lib/hooks';
import { useWarehouses } from '@/lib/inventory';
import { useOrderPreview, type OrderPreview } from '@/lib/orders';
import { cn, money, number } from '@/lib/utils';

export interface OrderDraftLine {
  variantId: string;
  sku: string;
  description: string;
  quantity: string;
  unitPrice: string; // vacío = precio de lista del cliente
  discountPct: string;
}

export interface OrderFormValue {
  customer: { id: string; name: string } | null;
  warehouseId: string;
  requestedDate: string;
  notes: string;
  lines: OrderDraftLine[];
}

export interface OrderFormSubmit {
  customerId: string;
  warehouseId: string;
  branchId: string;
  requestedDate?: string;
  notes?: string;
  lines: { variantId: string; quantity: number; unitPrice?: number; discountPct: number }[];
}

/** Armado de pedido: cliente, depósito y líneas con precio, margen y disponible calculados por la API. */
export function OrderForm({ initial, lockCustomer, submitting, error, actions }: {
  initial?: Partial<OrderFormValue>;
  lockCustomer?: boolean;
  submitting: boolean;
  error?: string | null;
  actions: { label: string; variant?: 'default' | 'outline'; onSubmit: (data: OrderFormSubmit) => void }[];
}) {
  const { data: warehouses } = useWarehouses();
  const { data: me } = useMe();
  const canSeeCost = !!me?.permissions.includes('catalog.cost.read');
  const [value, setValue] = useState<OrderFormValue>({ customer: null, warehouseId: '', requestedDate: '', notes: '', lines: [], ...initial });
  const set = (patch: Partial<OrderFormValue>) => setValue((v) => ({ ...v, ...patch }));
  useEffect(() => {
    if (!value.warehouseId && warehouses?.length) set({ warehouseId: warehouses[0].id });
  }, [warehouses, value.warehouseId]);

  const parsed = useMemo(() => parseLines(value.lines), [value.lines]);
  const preview = useOrderPreview();
  const [result, setResult] = useState<OrderPreview | null>(null);
  useEffect(() => {
    if (!value.customer || !value.warehouseId || !parsed.ok || !parsed.lines.length) return void setResult(null);
    const t = setTimeout(() => {
      preview.mutate(
        { customerId: value.customer!.id, warehouseId: value.warehouseId, lines: parsed.lines },
        { onSuccess: setResult, onError: () => setResult(null) },
      );
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.customer?.id, value.warehouseId, parsed.key]);

  const byVariant = new Map(result?.lines.map((l) => [l.variantId, l]));
  const addLine = (l: Omit<OrderDraftLine, 'quantity' | 'unitPrice' | 'discountPct'>) => {
    if (value.lines.some((x) => x.variantId === l.variantId)) return;
    set({ lines: [...value.lines, { ...l, quantity: '1', unitPrice: '', discountPct: '0' }] });
  };
  const updateLine = (i: number, patch: Partial<OrderDraftLine>) => set({ lines: value.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const submit = (onSubmit: (d: OrderFormSubmit) => void) => {
    const warehouse = warehouses?.find((w) => w.id === value.warehouseId);
    if (!value.customer || !warehouse || !parsed.ok || !parsed.lines.length) return;
    onSubmit({
      customerId: value.customer.id,
      warehouseId: warehouse.id,
      branchId: warehouse.branchId,
      requestedDate: optText(value.requestedDate),
      notes: optText(value.notes),
      lines: parsed.lines,
    });
  };
  const blocked = !value.customer || !parsed.ok || !parsed.lines.length || submitting || (result?.warnings.some((w) => w.includes('no tiene precio')) ?? false);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            {value.customer ? (
              <Field label="Cliente" htmlFor="customer">
                <div id="customer" className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm">
                  <span className="truncate font-medium">{value.customer.name}</span>
                  {!lockCustomer && (
                    <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Cambiar cliente" onClick={() => set({ customer: null })}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </Field>
            ) : (
              <CustomerPicker onPick={(customer) => set({ customer })} />
            )}
          </div>
          <Field label="Depósito" htmlFor="warehouse">
            <Select id="warehouse" value={value.warehouseId} onChange={(e) => set({ warehouseId: e.target.value })}>
              {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Entrega pedida" htmlFor="requestedDate">
            <Input id="requestedDate" type="date" value={value.requestedDate} onChange={(e) => set({ requestedDate: e.target.value })} />
          </Field>
          <Field label="Notas" htmlFor="notes" className="sm:col-span-2 lg:col-span-4">
            <Input id="notes" value={value.notes} placeholder="Horario de entrega, forma de pago, aclaraciones…" onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card className="overflow-x-auto">
        <CardHeader className="flex-row flex-wrap items-center gap-3">
          <CardTitle>Productos</CardTitle>
          <VariantPicker onPick={addLine} />
        </CardHeader>
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-y text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-4 py-2 text-right font-medium">Cantidad</th>
              <th className="px-4 py-2 text-right font-medium">Precio</th>
              <th className="px-4 py-2 text-right font-medium">Desc. %</th>
              <th className="px-4 py-2 text-right font-medium">Disponible</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
              {canSeeCost && <th className="px-4 py-2 text-right font-medium">Margen</th>}
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {value.lines.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Buscá productos por nombre o SKU para agregarlos.</td></tr>
            )}
            {value.lines.map((l, i) => {
              const p = byVariant.get(l.variantId);
              const qty = optNumber(l.quantity);
              const short = p && qty !== undefined && qty > p.available;
              return (
                <tr key={l.variantId} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <div>{l.description}</div>
                    <div className="font-mono text-xs text-muted-foreground">{l.sku}</div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Input aria-label={`Cantidad de ${l.sku}`} className="ml-auto h-8 w-20 text-right" inputMode="decimal" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Input
                      aria-label={`Precio de ${l.sku}`}
                      className="ml-auto h-8 w-28 text-right"
                      inputMode="decimal"
                      placeholder={p?.listPrice != null ? number(p.listPrice) : 'sin precio'}
                      value={l.unitPrice}
                      onChange={(e) => updateLine(i, { unitPrice: e.target.value })}
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Input aria-label={`Descuento de ${l.sku}`} className="ml-auto h-8 w-16 text-right" inputMode="decimal" value={l.discountPct} onChange={(e) => updateLine(i, { discountPct: e.target.value })} />
                  </td>
                  <td className={cn('px-4 py-2 text-right tabular-nums', short && 'font-medium text-destructive')}>{p ? number(p.available) : '…'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p?.lineTotal != null ? money(p.lineTotal) : '—'}</td>
                  {canSeeCost && <td className="px-4 py-2 text-right tabular-nums">{p?.marginPct != null ? `${number(p.marginPct)} %` : '—'}</td>}
                  <td className="px-2 py-2">
                    <Button variant="ghost" size="icon" aria-label={`Quitar ${l.sku}`} onClick={() => set({ lines: value.lines.filter((_, j) => j !== i) })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex-1 space-y-2 text-sm">
          {!parsed.ok && <p className="text-destructive">{parsed.error}</p>}
          {result?.warnings.map((w) => <p key={w} className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2">{w}</p>)}
          {result?.lines.some((l) => l.quantity > l.available) && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
              Hay productos sin stock suficiente: el pedido se puede guardar como borrador, pero no confirmar hasta que entre mercadería.
            </p>
          )}
          {error && <p className="text-destructive">{error}</p>}
        </div>
        <Card className="w-full lg:w-80">
          <CardContent className="space-y-2 p-5 text-sm">
            <Row label="Subtotal" value={money(result?.subtotal)} />
            {!!result?.discountTotal && <Row label="Descuentos" value={`− ${money(result.discountTotal)}`} />}
            <Row label="Total sin IVA" value={money(result?.total)} strong />
            {canSeeCost && result?.marginTotal != null && <Row label="Margen" value={money(result.marginTotal)} />}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {actions.map((a) => (
                <Button key={a.label} variant={a.variant} disabled={blocked} onClick={() => submit(a.onSubmit)}>{a.label}</Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between', strong && 'text-base font-semibold')}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function parseLines(lines: OrderDraftLine[]) {
  const out: OrderFormSubmit['lines'] = [];
  for (const l of lines) {
    const quantity = optNumber(l.quantity);
    const unitPrice = optNumber(l.unitPrice);
    const discountPct = optNumber(l.discountPct) ?? 0;
    if (quantity === undefined || Number.isNaN(quantity) || quantity <= 0) return { ok: false as const, error: `Cantidad inválida en ${l.sku}`, key: '', lines: [] };
    if (unitPrice !== undefined && (Number.isNaN(unitPrice) || unitPrice < 0)) return { ok: false as const, error: `Precio inválido en ${l.sku}`, key: '', lines: [] };
    if (Number.isNaN(discountPct) || discountPct < 0 || discountPct > 100) return { ok: false as const, error: `Descuento inválido en ${l.sku}`, key: '', lines: [] };
    out.push({ variantId: l.variantId, quantity, discountPct, ...(unitPrice !== undefined && { unitPrice }) });
  }
  return { ok: true as const, error: '', key: JSON.stringify(out), lines: out };
}

function CustomerPicker({ onPick }: { onPick: (c: { id: string; name: string }) => void }) {
  const [q, setQ] = useState('');
  const { data } = useCustomers(q, 1);
  return (
    <Field label="Cliente" htmlFor="customer-search">
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input id="customer-search" className="pl-9" placeholder="Buscar por nombre, CUIT o teléfono" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        {q.length >= 2 && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-card shadow-lg">
            {data?.items.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Sin resultados</li>}
            {data?.items.map((c) => (
              <li key={c.id}>
                <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => onPick({ id: c.id, name: c.tradeName ?? c.legalName })}>
                  <span className="font-medium">{c.tradeName ?? c.legalName}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.code}{c.status !== 'ACTIVE' && ` · ${c.status.toLowerCase()}`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

function VariantPicker({ onPick }: { onPick: (l: { variantId: string; sku: string; description: string }) => void }) {
  const [q, setQ] = useState('');
  const { data } = useProducts(q, 1);
  const options = q.length >= 2 ? data?.items.flatMap((p) => p.variants.filter((v) => v.isActive).map((v) => ({ p, v }))).slice(0, 30) : [];
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
                onClick={() => { onPick({ variantId: v.id, sku: v.sku, description: `${p.name} ${v.name}` }); setQ(''); }}
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
