'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAssignCertification, useCertifications, useProduct, useUpdateCost, type VariantRow } from '@/lib/catalog';
import { optNumber } from '@/lib/form';
import { useMe } from '@/lib/hooks';
import { date, money, number } from '@/lib/utils';

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: p, isLoading } = useProduct(id);
  const { data: me } = useMe();
  const canWrite = !!me?.permissions.includes('catalog.product.write');
  const canSeeCost = !!me?.permissions.includes('catalog.cost.read');
  if (isLoading || !p) return <Skeleton className="mx-auto h-96 max-w-6xl" />;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href="/products" className="text-sm text-muted-foreground hover:underline">← Productos</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          {!p.isActive && <Badge tone="neutral">Inactivo</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {p.code} · {p.category?.name ?? 'sin categoría'} · origen {p.origin ?? '—'} · vida útil {p.shelfLifeDays ? `${p.shelfLifeDays} días` : '—'}
        </p>
      </div>

      <Card className="overflow-x-auto">
        <CardHeader><CardTitle>Presentaciones y precios</CardTitle></CardHeader>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-y text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Presentación</th>
              <th className="px-4 py-2 font-medium">SKU</th>
              <th className="px-4 py-2 text-right font-medium">Peso</th>
              {canSeeCost && <th className="px-4 py-2 text-right font-medium">Costo</th>}
              <th className="px-4 py-2 font-medium">Precios por lista</th>
            </tr>
          </thead>
          <tbody>
            {p.variants.map((v) => (
              <tr key={v.id} className="border-b align-top last:border-0">
                <td className="px-4 py-3">{v.name}{!v.isActive && <Badge className="ml-2">inactiva</Badge>}</td>
                <td className="px-4 py-3 font-mono text-xs">{v.sku}</td>
                <td className="px-4 py-3 text-right tabular-nums">{v.netWeightKg == null ? 'por unidad' : `${number(v.netWeightKg)} kg`}</td>
                {canSeeCost && <td className="px-4 py-3 text-right"><CostCell variant={v} canWrite={canWrite} /></td>}
                <td className="px-4 py-3">
                  {v.prices?.length ? (
                    <ul className="space-y-1">
                      {v.prices.map((x) => (
                        <li key={`${x.priceListId}-${x.minQuantity}`} className="flex flex-wrap items-center gap-2">
                          <span className="text-muted-foreground">{x.priceList}{x.minQuantity > 1 && ` desde ${number(x.minQuantity)}`}:</span>
                          <span className="tabular-nums">{money(x.price)}</span>
                          {x.marginPct != null && <Badge tone={x.marginPct < v.minMarginPct ? 'bad' : 'neutral'}>{number(x.marginPct)} %</Badge>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">Sin precios. <Link className="underline" href="/price-lists">Cargar en una lista</Link></span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Certifications productId={p.id} current={p.certifications} canWrite={canWrite} />
    </div>
  );
}

function CostCell({ variant, canWrite }: { variant: VariantRow; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const update = useUpdateCost();
  if (!editing) {
    return (
      <div className="flex items-center justify-end gap-2">
        <span className="tabular-nums">{money(variant.currentCost)}</span>
        {canWrite && <Button variant="ghost" size="sm" onClick={() => { setValue(String(variant.currentCost ?? '')); setEditing(true); }}>Cambiar</Button>}
      </div>
    );
  }
  const n = optNumber(value);
  const save = async () => {
    if (n === undefined || Number.isNaN(n) || n < 0) return;
    await update.mutateAsync({ variantId: variant.id, cost: n, source: 'manual' });
    setEditing(false);
  };
  return (
    <div className="flex items-center justify-end gap-2">
      <Input aria-label={`Nuevo costo de ${variant.sku}`} className="h-8 w-28 text-right" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <Button size="sm" onClick={save} disabled={update.isPending || n === undefined || Number.isNaN(n)}>Guardar</Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
    </div>
  );
}

function Certifications({ productId, current, canWrite }: {
  productId: string;
  current: { certificationId: string; certificateNo: string | null; validUntil: string | null; certification: { name: string } }[];
  canWrite: boolean;
}) {
  const { data: all } = useCertifications();
  const assign = useAssignCertification(productId);
  const [form, setForm] = useState({ certificationId: '', certificateNo: '', validUntil: '' });
  const soon = Date.now() + 60 * 864e5;

  return (
    <Card>
      <CardHeader><CardTitle>Certificaciones</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        {current.length === 0 && <p className="text-muted-foreground">Sin certificaciones cargadas.</p>}
        <ul className="space-y-2">
          {current.map((c) => {
            const expires = c.validUntil ? new Date(c.validUntil).getTime() : null;
            return (
              <li key={c.certificationId} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.certification.name}</span>
                {c.certificateNo && <span className="text-muted-foreground">N.º {c.certificateNo}</span>}
                {expires && (
                  <Badge tone={expires < Date.now() ? 'bad' : expires < soon ? 'warn' : 'neutral'}>
                    {expires < Date.now() ? 'vencido' : 'vence'} {date(c.validUntil)}
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
        {canWrite && (
          <form
            className="grid gap-3 border-t pt-4 sm:grid-cols-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!form.certificationId) return;
              await assign.mutateAsync({
                certificationId: form.certificationId,
                certificateNo: form.certificateNo || undefined,
                validUntil: form.validUntil || undefined,
              });
              setForm({ certificationId: '', certificateNo: '', validUntil: '' });
            }}
          >
            <Field label="Certificación" htmlFor="cert">
              <Select id="cert" value={form.certificationId} onChange={(e) => setForm({ ...form, certificationId: e.target.value })}>
                <option value="">Elegir…</option>
                {all?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="N.º de certificado" htmlFor="certNo">
              <Input id="certNo" value={form.certificateNo} onChange={(e) => setForm({ ...form, certificateNo: e.target.value })} />
            </Field>
            <Field label="Vence" htmlFor="validUntil">
              <Input id="validUntil" type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" variant="outline" disabled={!form.certificationId || assign.isPending}>Guardar certificación</Button>
            </div>
            {assign.error && <p className="text-xs text-destructive sm:col-span-4">{assign.error.message}</p>}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
