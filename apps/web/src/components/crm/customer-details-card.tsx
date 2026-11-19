'use client';

import { useState } from 'react';
import { updateCustomerSchema } from '@spiceos/contracts';
import { Clock, Mail, MapPin, Pencil, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useUpdateCustomer } from '@/lib/crm';
import { optText, useZodForm } from '@/lib/form';
import { AddressAndDeliveryFields, deliveryInitial, formatDays, toAddress, toDays } from './customer-fields';

export interface CustomerDetails {
  id: string;
  version: number;
  phone: string | null;
  email: string | null;
  deliveryDays: string[];
  deliveryHours: string | null;
  addresses: { street: string; city: string; province: string; deliveryNote: string | null }[];
}

/** Teléfono, dirección, mail y días/horario de recepción. Teléfono y dirección son obligatorios. */
export function CustomerDetailsCard({ customer: c, missing, canWrite }: { customer: CustomerDetails; missing: string[]; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateCustomer(c.id);
  const initial = { phone: c.phone ?? '', email: c.email ?? '', ...deliveryInitial(c) };
  const form = useZodForm(
    // Al editar, teléfono y dirección también son obligatorios.
    updateCustomerSchema.required({ phone: true, address: true }),
    initial,
    (v) => ({
      version: c.version,
      phone: optText(v.phone),
      email: optText(v.email) ?? null,
      address: toAddress(v),
      deliveryDays: toDays(v),
      deliveryHours: optText(v.deliveryHours) ?? null,
    }),
  );
  const a = c.addresses[0];
  const days = formatDays(c.deliveryDays);

  const open = () => {
    form.setValues(initial);
    setEditing(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = form.validate();
    if (!data) return;
    await update.mutateAsync(data);
    setEditing(false);
  };

  return (
    <Card className={missing.length ? 'border-warning' : undefined}>
      <CardHeader className="flex-row items-center">
        <CardTitle>Datos de contacto y entrega</CardTitle>
        {canWrite && !editing && (
          <Button variant={missing.length ? 'default' : 'ghost'} size="sm" className="ml-auto" onClick={open}>
            <Pencil className="h-4 w-4" /> {missing.length ? 'Completar' : 'Editar'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {!editing && (
          <dl className="space-y-2">
            <Row icon={<Phone className="h-4 w-4" />} label="Teléfono" value={c.phone} required />
            <Row
              icon={<MapPin className="h-4 w-4" />}
              label="Dirección"
              value={a ? [a.street, a.city, a.province].filter(Boolean).join(', ') + (a.deliveryNote ? ` (${a.deliveryNote})` : '') : null}
              required
            />
            <Row icon={<Mail className="h-4 w-4" />} label="Email" value={c.email} />
            <Row icon={<Clock className="h-4 w-4" />} label="Recibe pedidos" value={[days, c.deliveryHours].filter(Boolean).join(', ') || null} />
          </dl>
        )}
        {editing && (
          <form onSubmit={submit} className="grid gap-3">
            <Field label="Teléfono o WhatsApp" htmlFor="phone" error={form.errors.phone} hint="Ej.: 011 15-4444-5555">
              <Input {...form.bind('phone')} inputMode="tel" />
            </Field>
            <Field label="Email (opcional)" htmlFor="email" error={form.errors.email}>
              <Input {...form.bind('email')} type="email" />
            </Field>
            <AddressAndDeliveryFields bind={form.bind} errors={form.errors} values={form.values} setValues={form.setValues} />
            {update.error && <p className="text-xs text-destructive">{update.error.message}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancelar</Button>
              <Button type="submit" size="sm" disabled={update.isPending}>{update.isPending ? 'Guardando…' : 'Guardar'}</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ icon, label, value, required }: { icon: React.ReactNode; label: string; value: string | null; required?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className={!value && required ? 'font-medium text-warning' : !value ? 'text-muted-foreground' : undefined}>
          {value ?? (required ? 'Falta cargar' : 'Sin dato')}
        </dd>
      </div>
    </div>
  );
}
