'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { money } from '@/lib/utils';
import { useRecommendations, useResetRecommendations, useSaveRecommendations, type RecommendationsView, type Segment } from '@/lib/recommendations';

const HINTS: Record<Segment, string> = {
  MINORISTA: 'Sueltos (códigos que terminan en -U). En la web se muestran debajo de los combos.',
  ROTISERIA: 'Cajas y bolsas.',
  CATERING: 'Cajas y bolsas.',
  PIZZERIA: 'Cajas y bolsas.',
  PASTELERIA: 'Cajas y bolsas.',
};

export default function RecommendationsPage() {
  const { data, isLoading } = useRecommendations();
  const [segment, setSegment] = useState<Segment>('MINORISTA');
  if (isLoading || !data) return <Skeleton className="mx-auto h-96 max-w-3xl" />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/settings" className="text-sm text-muted-foreground hover:underline">← Configuración</Link>
      <h1 className="text-2xl font-semibold">Productos recomendados</h1>
      <p className="text-sm text-muted-foreground">
        Lo primero que ve cada tipo de cliente en la web (después de elegir si compra por mayor o por menor y su rubro) y lo que el asistente de
        WhatsApp ofrece primero. El catálogo completo se sigue viendo abajo. Los productos dados de baja no se muestran aunque estén en la lista.
      </p>

      <div className="flex flex-wrap gap-2">
        {data.segments.map((s) => (
          <Button key={s.segment} size="sm" variant={s.segment === segment ? 'default' : 'outline'} onClick={() => setSegment(s.segment)}>
            {s.label}
          </Button>
        ))}
      </div>

      <ListEditor key={segment} data={data} segment={segment} />

      {segment === 'MINORISTA' &&
        data.combos.map((c) => (
          <Card key={c.sku}>
            <CardHeader>
              <CardTitle className="text-base">
                {c.name} <span className="font-mono text-xs font-normal text-muted-foreground">[{c.sku}]</span>
                {c.price != null && <span className="font-normal text-muted-foreground"> · {money(c.price)}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {c.items.map((i) => (
                <div key={i.sku}>
                  {i.quantity} × {i.product} {i.presentation} <span className="text-muted-foreground">[{i.sku}]</span>
                  {!i.active && <Badge tone="warn" className="ml-2">Dado de baja</Badge>}
                </div>
              ))}
              <p className="pt-2 text-muted-foreground">
                {c.looseTotal != null && `Sueltos suman ${money(c.looseTotal)}. `}
                {c.firstPurchaseDiscountPct > 0 && `${c.firstPurchaseDiscountPct}% de descuento en la primera compra. `}
                {!c.available && 'No se ofrece: está dado de baja, le falta precio Minorista o tiene un sobre dado de baja. '}
                Se vende en una línea y al confirmar el pedido reserva cada sobre. El precio se cambia en Listas de precios.
              </p>
            </CardContent>
          </Card>
        ))}
    </div>
  );
}

function ListEditor({ data, segment }: { data: RecommendationsView; segment: Segment }) {
  const current = data.segments.find((s) => s.segment === segment)!;
  const [skus, setSkus] = useState(current.items.map((i) => i.sku));
  const [query, setQuery] = useState('');
  const save = useSaveRecommendations();
  const reset = useResetRecommendations();
  useEffect(() => setSkus(current.items.map((i) => i.sku)), [current]);

  const info = useMemo(() => {
    const m = new Map(current.items.map((i) => [i.sku, i]));
    for (const o of data.options) if (!m.has(o.sku)) m.set(o.sku, { ...o, active: true });
    return m;
  }, [current, data.options]);

  const dirty = skus.join('|') !== current.items.map((i) => i.sku).join('|');
  const q = query.trim().toLowerCase();
  const matches = q
    ? data.options
        .filter((o) => !skus.includes(o.sku))
        .filter((o) => (segment === 'MINORISTA' ? o.sku.endsWith('-U') : !o.sku.endsWith('-U')))
        .filter((o) => `${o.sku} ${o.product} ${o.presentation}`.toLowerCase().includes(q))
        .slice(0, 8)
    : [];
  const move = (i: number, d: -1 | 1) =>
    setSkus((s) => {
      const n = [...s];
      [n[i], n[i + d]] = [n[i + d]!, n[i]!];
      return n;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {current.label} {current.isDefault && <Badge>Sugerida</Badge>}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{HINTS[segment]}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="divide-y rounded border">
          {skus.map((sku, i) => {
            const it = info.get(sku);
            return (
              <li key={sku} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="w-5 text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="flex-1">
                  {it?.product ?? 'Código desconocido'} <span className="text-muted-foreground">{it?.presentation}</span>{' '}
                  <span className="text-xs text-muted-foreground">[{sku}]</span> {it && !it.active && <Badge tone="warn">Dado de baja</Badge>}
                </span>
                <Button size="icon" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Bajar" disabled={i === skus.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Sacar" onClick={() => setSkus((s) => s.filter((x) => x !== sku))}>
                  <X className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
          {!skus.length && <li className="px-3 py-2 text-sm text-muted-foreground">Sin productos: no se muestran recomendados para este tipo de cliente.</li>}
        </ol>

        <div className="space-y-1">
          <Input placeholder="Sumar producto: buscá por nombre o código" value={query} onChange={(e) => setQuery(e.target.value)} />
          {matches.length > 0 && (
            <div className="divide-y rounded border">
              {matches.map((o) => (
                <button
                  key={o.sku}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setSkus((s) => [...s, o.sku]);
                    setQuery('');
                  }}
                >
                  {o.product} <span className="text-muted-foreground">{o.presentation}</span> <span className="text-xs text-muted-foreground">[{o.sku}]</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {(save.error || reset.error) && <p className="mr-auto text-sm text-destructive">{(save.error ?? reset.error)!.message}</p>}
          {save.isSuccess && !dirty && <p className="mr-auto text-sm text-success">Guardado. La web lo toma en un minuto.</p>}
          {!current.isDefault && (
            <Button variant="outline" disabled={reset.isPending} onClick={() => reset.mutate(segment)}>
              Volver a la sugerida
            </Button>
          )}
          <Button variant="outline" disabled={!dirty} onClick={() => setSkus(current.items.map((i) => i.sku))}>
            Descartar cambios
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate({ segment, skus })}>
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
