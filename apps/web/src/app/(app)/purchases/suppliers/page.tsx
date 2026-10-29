'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { optText } from '@/lib/form';
import { useMe } from '@/lib/hooks';
import { useCreateSupplier, useSupplierProducts, useSuppliers, useUpdateSupplier, type Supplier } from '@/lib/purchasing';

export default function SuppliersPage() {
  const { data, isLoading } = useSuppliers();
  const { data: me } = useMe();
  const canWrite = !!me?.permissions.includes('purchasing.order.write');
  const [creating, setCreating] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link href="/purchases" className="text-sm text-muted-foreground hover:underline">← Notas de pedido</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Proveedores</h1>
        {canWrite && !creating && <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>Nuevo proveedor</Button>}
      </div>
      <p className="text-sm text-muted-foreground">
        Cada producto puede tener uno o varios proveedores; los faltantes se piden al preferido. Los sobres sueltos se piden como la caja de la que salen.
      </p>
      {creating && <NewSupplier onDone={() => setCreating(false)} />}
      {isLoading && <Skeleton className="h-40 w-full" />}
      {data?.map((s) => <SupplierCard key={s.id} supplier={s} canWrite={canWrite} />)}
    </div>
  );
}

function NewSupplier({ onDone }: { onDone: () => void }) {
  const create = useCreateSupplier();
  const [v, setV] = useState({ code: '', legalName: '', phone: '', email: '' });
  return (
    <Card>
      <CardContent className="grid gap-3 p-5 sm:grid-cols-4">
        <Field label="Código" htmlFor="s-code"><Input id="s-code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
        <Field label="Razón social" htmlFor="s-name" className="sm:col-span-3"><Input id="s-name" value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} /></Field>
        <Field label="Teléfono (WhatsApp)" htmlFor="s-phone" className="sm:col-span-2"><Input id="s-phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="Email" htmlFor="s-email" className="sm:col-span-2"><Input id="s-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <div className="flex items-center justify-end gap-2 sm:col-span-4">
          {create.error && <p className="mr-auto text-sm text-destructive">{create.error.message}</p>}
          <Button variant="ghost" onClick={onDone}>Cancelar</Button>
          <Button
            disabled={!v.code.trim() || v.legalName.trim().length < 2 || create.isPending}
            onClick={() => create.mutate({ code: v.code, legalName: v.legalName, phone: optText(v.phone), email: optText(v.email), leadTimeDays: 7 }, { onSuccess: onDone })}
          >
            Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SupplierCard({ supplier: s, canWrite }: { supplier: Supplier; canWrite: boolean }) {
  const update = useUpdateSupplier(s.id);
  const assign = useSupplierProducts(s.id);
  const [contact, setContact] = useState({ phone: s.phone ?? '', email: s.email ?? '' });
  const [skus, setSkus] = useState('');
  const list = skus.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const dirty = contact.phone !== (s.phone ?? '') || contact.email !== (s.email ?? '');

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3">
        <CardTitle>{s.legalName}</CardTitle>
        <Badge className="font-mono">{s.code}</Badge>
        {!s.isActive && <Badge tone="bad">Inactivo</Badge>}
        <span className="ml-auto text-sm text-muted-foreground">{s.products} productos asignados</span>
      </CardHeader>
      {canWrite && (
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Field label="Teléfono (para mandarle la nota por WhatsApp)" htmlFor={`p-${s.id}`}>
              <Input id={`p-${s.id}`} value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
            </Field>
            <Field label="Email" htmlFor={`e-${s.id}`}>
              <Input id={`e-${s.id}`} type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
            </Field>
            <div className="flex items-center justify-end gap-2">
              {update.error && <p className="mr-auto text-sm text-destructive">{update.error.message}</p>}
              <Button size="sm" variant="outline" disabled={!dirty || update.isPending} onClick={() => update.mutate({ phone: optText(contact.phone), email: optText(contact.email) })}>
                Guardar contacto
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Field label="Asignar productos por SKU" htmlFor={`k-${s.id}`} hint="Separados por coma, espacio o renglón. Quedan con este proveedor como preferido.">
              <textarea
                id={`k-${s.id}`}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={skus}
                onChange={(e) => setSkus(e.target.value)}
                placeholder="50, 258, 3017"
              />
            </Field>
            <div className="flex items-center justify-end gap-2">
              {assign.error && <p className="mr-auto text-sm text-destructive">{assign.error.message}</p>}
              {assign.isSuccess && <p className="mr-auto text-sm text-success">Listo: {assign.data.count} productos.</p>}
              <Button size="sm" variant="outline" disabled={!list.length || assign.isPending} onClick={() => assign.mutate({ skus: list, preferred: false, remove: true }, { onSuccess: () => setSkus('') })}>
                Quitar
              </Button>
              <Button size="sm" disabled={!list.length || assign.isPending} onClick={() => assign.mutate({ skus: list, preferred: true, remove: false }, { onSuccess: () => setSkus('') })}>
                Asignar
              </Button>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
