'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet } from 'lucide-react';
import type { ImportResult } from '@spiceos/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { download } from '@/lib/api';
import { useImport, type ImportKind } from '@/lib/crm';
import { cn } from '@/lib/utils';

const KINDS: Record<ImportKind, { title: string; help: string; back: string }> = {
  customers: {
    title: 'Clientes',
    help: 'Una fila por cliente. Se reconoce por CUIT: si ya existe, se saltea o se actualiza según elijas. Si hay columna "Contacto", se crea como contacto principal.',
    back: '/customers',
  },
  products: {
    title: 'Productos',
    help: 'Una fila por presentación; las filas con el mismo código de producto se agrupan. "Precio" carga la lista por defecto y "Precio <lista>" (por ejemplo "Precio Gastronomía") carga esa lista.',
    back: '/products',
  },
  stock: {
    title: 'Stock inicial',
    help: 'La plantilla trae una fila por presentación: completá cantidad, lote y vencimiento (una fila por lote). Las filas sin cantidad no se cargan. Si hay un solo depósito la columna "Depósito" es opcional. Si ese saldo ya tiene stock, se saltea o se lleva a la cantidad de la planilla según elijas.',
    back: '/inventory',
  },
};

export default function ImportsPage() {
  return (
    <Suspense>
      <Importer />
    </Suspense>
  );
}

function Importer() {
  const kindParam = useSearchParams().get('kind');
  const initial: ImportKind = kindParam === 'products' || kindParam === 'stock' ? kindParam : 'customers';
  const [kind, setKind] = useState<ImportKind>(initial);
  const [file, setFile] = useState<File | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('skip');
  const [review, setReview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const imports = { customers: useImport('customers'), products: useImport('products'), stock: useImport('stock') };
  const run = imports[kind];

  const reset = (next?: Partial<{ kind: ImportKind; file: File | null; onDuplicate: 'skip' | 'update' }>) => {
    if (next?.kind) setKind(next.kind);
    if (next && 'file' in next) setFile(next.file ?? null);
    if (next?.onDuplicate) setOnDuplicate(next.onDuplicate);
    setReview(null);
    setDone(null);
    run.reset();
  };

  const check = async () => file && setReview(await run.mutateAsync({ file, dryRun: true, onDuplicate }));
  const commit = async () => {
    if (!file) return;
    setDone(await run.mutateAsync({ file, dryRun: false, onDuplicate }));
    setReview(null);
  };
  const toWrite = review ? review.created + review.updated : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Importar desde Excel</h1>
        <Link href={KINDS[kind].back} className="ml-auto text-sm text-muted-foreground hover:underline">Volver a {KINDS[kind].title.toLowerCase()}</Link>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div role="tablist" aria-label="Qué importar" className="flex gap-2">
            {(Object.keys(KINDS) as ImportKind[]).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={k === kind}
                onClick={() => reset({ kind: k, file: null })}
                className={cn('rounded-full border px-3 py-1.5 text-sm', k === kind ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-accent')}
              >
                {KINDS[k].title}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{KINDS[kind].help}</p>
          <Button variant="outline" size="sm" onClick={() => download(`/imports/templates/${kind}`, `plantilla-${{ customers: 'clientes', products: 'productos', stock: 'stock' }[kind]}.xlsx`)}>
            <Download className="h-4 w-4" /> Descargar plantilla
          </Button>
          <div className="grid gap-4 sm:grid-cols-[1fr_220px_auto] sm:items-end">
            <Field label="Archivo .xlsx o .csv (hasta 5 MB)" htmlFor="file">
              <input
                id="file"
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => reset({ file: e.target.files?.[0] ?? null })}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
              />
            </Field>
            <Field label="Si ya existe" htmlFor="onDuplicate">
              <Select id="onDuplicate" value={onDuplicate} onChange={(e) => reset({ onDuplicate: e.target.value as 'skip' | 'update' })}>
                <option value="skip">Saltear la fila</option>
                <option value="update">Actualizar con la planilla</option>
              </Select>
            </Field>
            <Button onClick={check} disabled={!file || run.isPending}>
              <FileSpreadsheet className="h-4 w-4" /> {run.isPending && !review ? 'Revisando…' : 'Revisar planilla'}
            </Button>
          </div>
          {run.error && <p className="text-sm text-destructive">{run.error.message}</p>}
        </CardContent>
      </Card>

      {review && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center gap-3">
            <CardTitle>Revisión: nada se guardó todavía</CardTitle>
            <Button className="ml-auto" disabled={!toWrite || run.isPending} onClick={commit}>
              {run.isPending ? 'Importando…' : `Importar ${toWrite} filas`}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <Summary result={review} />
            {review.unknownColumns.length > 0 && (
              <p className="text-sm text-muted-foreground">Columnas que no se van a usar: {review.unknownColumns.join(', ')}</p>
            )}
            <Errors result={review} />
          </CardContent>
        </Card>
      )}

      {done && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-5 w-5 text-success" /> Importación terminada</p>
            <Summary result={done} />
            <Errors result={done} />
            <Button asChild variant="outline" size="sm"><Link href={KINDS[kind].back}>Ver {KINDS[kind].title.toLowerCase()}</Link></Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Summary({ result }: { result: ImportResult }) {
  const verb = result.dryRun ? 'Se van a' : 'Se';
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <Badge>{result.totalRows} filas leídas</Badge>
      <Badge tone="good">{verb} {result.dryRun ? 'crear' : 'crearon'} {result.created}</Badge>
      <Badge tone="brand">{verb} {result.dryRun ? 'actualizar' : 'actualizaron'} {result.updated}</Badge>
      {result.skipped > 0 && <Badge>{result.skipped} ya existen y se saltean</Badge>}
      {result.errors.length > 0 && <Badge tone="bad">{new Set(result.errors.map((e) => e.row)).size} filas con errores</Badge>}
    </div>
  );
}

function Errors({ result }: { result: ImportResult }) {
  if (!result.errors.length) return null;
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr><th className="px-3 py-2 font-medium">Fila</th><th className="px-3 py-2 font-medium">Problema</th></tr>
        </thead>
        <tbody>
          {result.errors.map((e, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-1.5 tabular-nums">{e.row}</td>
              <td className="px-3 py-1.5">{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
