'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { createProductSchema } from '@spiceos/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useCategories, useCreateProduct } from '@/lib/catalog';
import { optNumber, optText } from '@/lib/form';

type VariantDraft = Record<'sku' | 'name' | 'netWeightKg' | 'unit' | 'cost' | 'minMarginPct' | 'gtin', string>;
const emptyVariant = (): VariantDraft => ({ sku: '', name: '', netWeightKg: '', unit: 'UN', cost: '', minMarginPct: '25', gtin: '' });

export default function NewProductPage() {
  const router = useRouter();
  const { data: categories } = useCategories();
  const create = useCreateProduct();
  const [p, setP] = useState({ code: '', name: '', categoryId: '', origin: '', shelfLifeDays: '', description: '' });
  const [variants, setVariants] = useState<VariantDraft[]>([emptyVariant()]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setVariant = (i: number, key: keyof VariantDraft, value: string) =>
    setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, [key]: value } : v)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = createProductSchema.safeParse({
      code: p.code.trim().toUpperCase(),
      name: p.name.trim(),
      categoryId: optText(p.categoryId),
      origin: optText(p.origin),
      shelfLifeDays: optNumber(p.shelfLifeDays),
      description: optText(p.description),
      variants: variants.map((v) => ({
        sku: v.sku.trim().toUpperCase(),
        name: v.name.trim(),
        unit: v.unit,
        gtin: optText(v.gtin),
        netWeightKg: optNumber(v.netWeightKg),
        cost: optNumber(v.cost) ?? 0,
        minMarginPct: optNumber(v.minMarginPct) ?? 0,
      })),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path.join('.')] ??= issue.message;
      return setErrors(next);
    }
    setErrors({});
    const { id } = await create.mutateAsync(parsed.data);
    router.push(`/products/${id}`);
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Nuevo producto</h1>
        <Link href="/products" className="ml-auto text-sm text-muted-foreground hover:underline">Cancelar</Link>
      </div>

      <Card>
        <CardHeader><CardTitle>Producto</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Código" htmlFor="code" error={errors.code} hint="Ej.: PIM-AHU">
            <Input id="code" value={p.code} onChange={(e) => setP({ ...p, code: e.target.value })} />
          </Field>
          <Field label="Nombre" htmlFor="name" error={errors.name}>
            <Input id="name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="Pimentón ahumado" />
          </Field>
          <Field label="Categoría" htmlFor="categoryId">
            <Select id="categoryId" value={p.categoryId} onChange={(e) => setP({ ...p, categoryId: e.target.value })}>
              <option value="">Sin categoría</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Origen" htmlFor="origin">
            <Input id="origin" value={p.origin} onChange={(e) => setP({ ...p, origin: e.target.value })} placeholder="España" />
          </Field>
          <Field label="Vida útil (días)" htmlFor="shelfLifeDays" error={errors.shelfLifeDays}>
            <Input id="shelfLifeDays" inputMode="numeric" value={p.shelfLifeDays} onChange={(e) => setP({ ...p, shelfLifeDays: e.target.value })} />
          </Field>
          <Field label="Descripción" htmlFor="description" className="sm:col-span-2">
            <textarea
              id="description"
              rows={3}
              value={p.description}
              onChange={(e) => setP({ ...p, description: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center">
          <CardTitle>Presentaciones</CardTitle>
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setVariants([...variants, emptyVariant()])}>
            <Plus className="h-4 w-4" /> Agregar presentación
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {errors.variants && <p className="text-xs text-destructive">{errors.variants}</p>}
          {variants.map((v, i) => (
            <div key={i} className="grid gap-3 rounded-md border p-3 sm:grid-cols-4">
              <Field label="SKU" htmlFor={`sku-${i}`} error={errors[`variants.${i}.sku`]}>
                <Input id={`sku-${i}`} value={v.sku} onChange={(e) => setVariant(i, 'sku', e.target.value)} placeholder="PIM-AHU-1KG" />
              </Field>
              <Field label="Presentación" htmlFor={`name-${i}`} error={errors[`variants.${i}.name`]}>
                <Input id={`name-${i}`} value={v.name} onChange={(e) => setVariant(i, 'name', e.target.value)} placeholder="1 kg" />
              </Field>
              <Field label="Peso neto (kg)" htmlFor={`kg-${i}`} error={errors[`variants.${i}.netWeightKg`]}>
                <Input id={`kg-${i}`} inputMode="decimal" value={v.netWeightKg} onChange={(e) => setVariant(i, 'netWeightKg', e.target.value)} />
              </Field>
              <Field label="Unidad de venta" htmlFor={`unit-${i}`}>
                <Select id={`unit-${i}`} value={v.unit} onChange={(e) => setVariant(i, 'unit', e.target.value)}>
                  <option value="UN">Unidad</option>
                  <option value="KG">Kilo</option>
                </Select>
              </Field>
              <Field label="Costo" htmlFor={`cost-${i}`} error={errors[`variants.${i}.cost`]}>
                <Input id={`cost-${i}`} inputMode="decimal" value={v.cost} onChange={(e) => setVariant(i, 'cost', e.target.value)} />
              </Field>
              <Field label="Margen mínimo %" htmlFor={`margin-${i}`} error={errors[`variants.${i}.minMarginPct`]}>
                <Input id={`margin-${i}`} inputMode="decimal" value={v.minMarginPct} onChange={(e) => setVariant(i, 'minMarginPct', e.target.value)} />
              </Field>
              <Field label="EAN (opcional)" htmlFor={`gtin-${i}`} error={errors[`variants.${i}.gtin`]}>
                <Input id={`gtin-${i}`} inputMode="numeric" value={v.gtin} onChange={(e) => setVariant(i, 'gtin', e.target.value)} />
              </Field>
              <div className="flex items-end">
                {variants.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setVariants(variants.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" /> Quitar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Guardando…' : 'Crear producto'}</Button>
      </div>
    </form>
  );
}
