'use client';

import { useState } from 'react';
import { contactSchema } from '@spiceos/contracts';
import { Star, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAddContact, useContacts, useMakePrimary, useRemoveContact } from '@/lib/crm';
import { optText, useZodForm } from '@/lib/form';

/** Contactos del cliente. El teléfono se usa para reconocer los WhatsApp que llegan. */
export function ContactsCard({ customerId, canWrite }: { customerId: string; canWrite: boolean }) {
  const { data: contacts } = useContacts(customerId);
  const add = useAddContact(customerId);
  const makePrimary = useMakePrimary(customerId);
  const remove = useRemoveContact(customerId);
  const [open, setOpen] = useState(false);
  const form = useZodForm(contactSchema, { fullName: '', position: '', phone: '', email: '' }, (v) => ({
    fullName: v.fullName.trim(),
    position: optText(v.position),
    phone: optText(v.phone),
    email: optText(v.email),
    isPrimary: false,
  }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = form.validate();
    if (!data) return;
    await add.mutateAsync(data);
    form.reset();
    setOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center">
        <CardTitle>Contactos</CardTitle>
        {canWrite && !open && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(true)}>Agregar</Button>}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {contacts?.length === 0 && !open && <p className="text-muted-foreground">Sin contactos cargados.</p>}
        {contacts?.map((c) => (
          <div key={c.id} className="flex items-start gap-2">
            <div className="flex-1">
              <div className="font-medium">
                {c.fullName} {c.isPrimary && <Badge tone="brand" className="ml-1">principal</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">{[c.position, c.phone, c.email].filter(Boolean).join(' · ') || 'sin datos'}</div>
            </div>
            {canWrite && !c.isPrimary && (
              <Button variant="ghost" size="icon" aria-label={`Hacer principal a ${c.fullName}`} onClick={() => makePrimary.mutate(c.id)}>
                <Star className="h-4 w-4" />
              </Button>
            )}
            {canWrite && (
              <Button variant="ghost" size="icon" aria-label={`Quitar a ${c.fullName}`} onClick={() => remove.mutate(c.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        {open && (
          <form onSubmit={submit} className="space-y-3 border-t pt-3">
            <Field label="Nombre" htmlFor="fullName" error={form.errors.fullName}><Input {...form.bind('fullName')} /></Field>
            <Field label="Cargo" htmlFor="position"><Input {...form.bind('position')} placeholder="Compras, dueño, chef…" /></Field>
            <Field label="Teléfono o WhatsApp" htmlFor="phone"><Input {...form.bind('phone')} inputMode="tel" /></Field>
            <Field label="Email" htmlFor="email" error={form.errors.email}><Input {...form.bind('email')} type="email" /></Field>
            {add.error && <p className="text-xs text-destructive">{add.error.message}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={add.isPending}>Guardar</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
