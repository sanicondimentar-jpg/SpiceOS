'use client';

import type { ReceiptReading } from '@spiceos/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Camera, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useProducts } from '@/lib/catalog';
import { optNumber, optText } from '@/lib/form';
import { useMe } from '@/lib/hooks';
import { fetchBlob } from '@/lib/api';
import { useReceiveStock, useWarehouses } from '@/lib/inventory';
import { useSuppliers } from '@/lib/purchasing';
import { today } from '@/lib/supplier-accounts';
import { SOURCE_LABEL, useConfirmPendingReceipt, useDiscardPendingReceipt, usePendingReceipt, usePendingReceipts, useReadReceipt } from '@/lib/receipts';
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

/** Ingreso de mercadería con lote y vencimiento por renglón; se puede completar leyendo la foto del remito. */
export default function ReceivePage() {
  return (
    <Suspense>
      <ReceiveForm />
    </Suspense>
  );
}

type ReadingInfo = Omit<ReceiptReading, 'lines'> & { lines: number; from: string };

function ReceiveForm() {
  const router = useRouter();
  const pendingId = useSearchParams().get('pending');
  const { data: warehouses } = useWarehouses();
  const { data: me } = useMe();
  const canSeeCost = !!me?.permissions.includes('catalog.cost.read');
  const receive = useReceiveStock();
  const readReceipt = useReadReceipt();
  const pending = usePendingReceipt(pendingId);
  const confirm = useConfirmPendingReceipt(pendingId ?? '');
  const discard = useDiscardPendingReceipt(pendingId ?? '');
  const { data: pendingList } = usePendingReceipts(!pendingId);
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: suppliers } = useSuppliers();
  const [warehouseId, setWarehouseId] = useState('');
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [documentDate, setDocumentDate] = useState(today());
  const [reference, setReference] = useState('');
  const [updateCost, setUpdateCost] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [info, setInfo] = useState<ReadingInfo | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!warehouseId && warehouses?.length) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);
  // Hoy se compra a un solo proveedor: queda elegido salvo que el remito diga otro.
  const activeSuppliers = suppliers?.filter((s) => s.isActive) ?? [];
  useEffect(() => {
    if (supplierId === null && !pendingId && suppliers) setSupplierId(activeSuppliers.length === 1 ? activeSuppliers[0].id : '');
  }, [suppliers, supplierId, pendingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyReading = (r: ReceiptReading, from: string) => {
    if (r.reference) setReference(r.reference);
    if (r.documentDate) setDocumentDate(r.documentDate.slice(0, 10));
    setLines((prev) => {
      const read = r.lines.map((l) => ({
        variantId: l.variantId,
        sku: l.sku,
        description: l.description,
        cost: l.currentCost,
        quantity: String(l.quantity),
        lotCode: '',
        expiresAt: '',
        unitCost: l.unitCost != null ? String(l.unitCost) : '',
      }));
      return [...prev.filter((p) => !read.some((x) => x.variantId === p.variantId)), ...read];
    });
    setInfo({ ...r, lines: r.lines.length, from });
  };

  // Remito por confirmar (WhatsApp o Claude): se carga una sola vez en el formulario, con su foto al lado.
  useEffect(() => {
    if (!pending.data || applied.current === pending.data.id) return;
    applied.current = pending.data.id;
    const d = pending.data;
    setSupplierId(d.supplier?.id ?? (activeSuppliers.length === 1 ? activeSuppliers[0].id : ''));
    applyReading(d.reading, `${SOURCE_LABEL[d.source]}${d.supplier ? ` · ${d.supplier.name}` : ''}${d.sender ? ` · ${d.sender}` : ''}`);
    if (d.hasImage) {
      fetchBlob(`/receipts/pending/${d.id}/image`).then((b) => setPreview(URL.createObjectURL(b))).catch(() => undefined);
    }
  }, [pending.data]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null);
    readReceipt.mutate(file, { onSuccess: (r) => applyReading(r, 'Foto del remito'), onError: (e) => setError(e.message) });
  };

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
    const input = { warehouseId, supplierId: supplierId || undefined, documentDate: documentDate || undefined, reference: optText(reference), updateCost, lines: out };
    const done = { onSuccess: () => router.push('/inventory'), onError: (e: Error) => setError(e.message) };
    if (pendingId) confirm.mutate(input, done);
    else receive.mutate(input, done);
  };
  const saving = receive.isPending || confirm.isPending;
  const resolved = pending.data && pending.data.status !== 'PENDING';
  const linesTotal = lines.reduce((sum, l) => sum + (optNumber(l.quantity) ?? 0) * (optNumber(l.unitCost) ?? 0), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{pendingId ? 'Confirmar remito' : 'Ingreso de mercadería'}</h1>
        <Link href="/inventory" className="ml-auto text-sm text-muted-foreground hover:underline">Volver a inventario</Link>
      </div>

      {!pendingId && !!pendingList?.length && (
        <Card className="border-warning/50">
          <CardContent className="space-y-2 p-4">
            <h2 className="font-semibold">Remitos por confirmar ({pendingList.length})</h2>
            <p className="text-sm text-muted-foreground">Llegaron por WhatsApp de un proveedor autorizado o los cargó Claude. No suman stock hasta que los revises.</p>
            <ul className="divide-y text-sm">
              {pendingList.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Badge tone="warn">{SOURCE_LABEL[p.source]}</Badge>
                  <span className="font-medium">{p.supplier?.name ?? p.sender ?? 'Sin proveedor'}</span>
                  <span className="text-muted-foreground">{p.reference ?? 'Sin número'} · {p.lines} productos{p.unmatched ? ` · ${p.unmatched} sin reconocer` : ''}</span>
                  <span className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  <Link href={`/inventory/receive?pending=${p.id}`} className="ml-auto"><Button size="sm" variant="outline">Revisar</Button></Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {pendingId && pending.isLoading && <p className="text-sm text-muted-foreground">Cargando remito…</p>}
      {resolved && (
        <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          Este remito ya fue {pending.data!.status === 'CONFIRMED' ? 'confirmado' : 'descartado'}. <Link href="/inventory/receive" className="underline">Cargar otro ingreso</Link>
        </p>
      )}

      <div className={preview ? 'grid gap-4 lg:grid-cols-[1fr_320px]' : 'space-y-4'}>
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
              <Field label="Depósito" htmlFor="warehouse">
                <Select id="warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </Field>
              <Field label="Proveedor" htmlFor="supplier" hint={supplierId ? 'Queda como compra a pagar en Compras → Pagos a proveedores' : undefined}>
                <Select id="supplier" value={supplierId ?? ''} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Sin proveedor (no queda deuda)</option>
                  {suppliers?.filter((s) => s.isActive || s.id === supplierId).map((s) => <option key={s.id} value={s.id}>{s.legalName}</option>)}
                </Select>
              </Field>
              <Field label="Remito o factura del proveedor" htmlFor="reference">
                <Input id="reference" value={reference} placeholder="0001-00012345" onChange={(e) => setReference(e.target.value)} />
              </Field>
              <Field label="Fecha del remito" htmlFor="document-date">
                <Input id="document-date" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
              </Field>
              {canSeeCost && (
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
                  Actualizar el costo de los productos con el de este ingreso
                </label>
              )}
              {!pendingId && (
                <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
                  <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
                  <Button variant="outline" disabled={readReceipt.isPending} onClick={() => fileInput.current?.click()}>
                    <Camera className="mr-2 h-4 w-4" />
                    {readReceipt.isPending ? 'Leyendo el remito…' : 'Leer remito con foto'}
                  </Button>
                  <span className="text-sm text-muted-foreground">Sacale una foto o subí el PDF: completa productos, cantidades y costos para que los revises.</span>
                </div>
              )}
            </CardContent>
          </Card>

          {info && (
            <Card>
              <CardContent className="space-y-1 p-4 text-sm">
                <p>
                  <span className="font-medium">{info.from}:</span> {info.lines} productos reconocidos
                  {info.documentDate && <> · fecha {info.documentDate.split('-').reverse().join('/')}</>}
                  {info.discountPct != null && <> · descuento {info.discountPct}% (ya aplicado al costo)</>}
                </p>
                {canSeeCost && info.total != null && (
                  <p className={Math.abs(info.total - linesTotal) > Math.max(1, info.total * 0.005) ? 'text-warning' : 'text-muted-foreground'}>
                    Total del remito {money(info.total)} · suma de los renglones {money(linesTotal)}
                  </p>
                )}
                {!!info.unmatched.length && (
                  <div className="text-warning">
                    No reconocí estos renglones; agregalos a mano con el buscador:
                    <ul className="ml-5 list-disc">
                      {info.unmatched.map((u, i) => <li key={i}>{u.sourceText}{u.quantity != null && ` × ${u.quantity}`}</li>)}
                    </ul>
                  </div>
                )}
                <p className="text-muted-foreground">Revisá todo antes de registrar: el stock recién se suma al confirmar.</p>
              </CardContent>
            </Card>
          )}

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
        </div>
        {preview && (
          <Card className="h-fit overflow-hidden lg:sticky lg:top-4">
            <a href={preview} target="_blank" rel="noreferrer" title="Abrir la foto en grande">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Foto del remito" className="w-full" />
            </a>
          </Card>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && <p className="mr-auto text-sm text-destructive">{error}</p>}
        {pendingId && !resolved && (
          <Button variant="outline" disabled={discard.isPending || saving} onClick={() => discard.mutate(undefined, { onSuccess: () => router.push('/inventory/receive'), onError: (e) => setError(e.message) })}>
            Descartar remito
          </Button>
        )}
        <Button disabled={!lines.length || !warehouseId || saving || !!resolved} onClick={submit}>
          {saving ? 'Guardando…' : `${pendingId ? 'Confirmar ingreso' : 'Registrar ingreso'} (${lines.length})`}
        </Button>
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
