'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createCustomerSchema } from '@spiceos/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { usePriceLists } from '@/lib/catalog';
import { useCreateCustomer } from '@/lib/crm';
import { optNumber, optText, useZodForm } from '@/lib/form';

const INDUSTRIES = ['Restaurante', 'Parrilla', 'Frigorífico', 'Panadería', 'Fábrica de alimentos', 'Distribuidor', 'Almacén', 'Dietética', 'Otro'];

export default function NewCustomerPage() {
  const router = useRouter();
  const { data: lists } = usePriceLists();
  const create = useCreateCustomer();
  const form = useZodForm(
    createCustomerSchema,
    { legalName: '', tradeName: '', taxId: '', taxCondition: '', industry: '', phone: '', email: '', priceListId: '', paymentTermsDays: '0', creditLimit: '' },
    (v) => ({
      legalName: v.legalName.trim(),
      tradeName: optText(v.tradeName),
      taxId: optText(v.taxId),
      taxCondition: optText(v.taxCondition),
      industry: optText(v.industry),
      phone: optText(v.phone),
      email: optText(v.email),
      priceListId: optText(v.priceListId),
      paymentTermsDays: optNumber(v.paymentTermsDays) ?? 0,
      creditLimit: optNumber(v.creditLimit),
      source: 'manual',
      tags: [],
    }),
  );
  const { bind, errors } = form;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = form.validate();
    if (!data) return;
    const { id } = await create.mutateAsync(data);
    router.push(`/customers/${id}`);
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Nuevo cliente</h1>
        <Link href="/customers" className="ml-auto text-sm text-muted-foreground hover:underline">Cancelar</Link>
      </div>
      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Razón social" htmlFor="legalName" error={errors.legalName}><Input {...bind('legalName')} /></Field>
          <Field label="Nombre de fantasía" htmlFor="tradeName"><Input {...bind('tradeName')} /></Field>
          <Field label="CUIT" htmlFor="taxId" error={errors.taxId} hint="Con o sin guiones"><Input {...bind('taxId')} inputMode="numeric" /></Field>
          <Field label="Condición frente al IVA" htmlFor="taxCondition">
            <Select {...bind('taxCondition')}>
              <option value="">Sin dato</option>
              <option value="RI">Responsable inscripto</option>
              <option value="MONOTRIBUTO">Monotributo</option>
              <option value="CF">Consumidor final</option>
              <option value="EXENTO">Exento</option>
            </Select>
          </Field>
          <Field label="Rubro" htmlFor="industry">
            <Select {...bind('industry')}>
              <option value="">Sin dato</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </Select>
          </Field>
          <Field label="Teléfono o WhatsApp" htmlFor="phone" error={errors.phone} hint="Ej.: 011 15-4444-5555">
            <Input {...bind('phone')} inputMode="tel" />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email}><Input {...bind('email')} type="email" /></Field>
          <Field label="Lista de precios" htmlFor="priceListId">
            <Select {...bind('priceListId')}>
              <option value="">La lista por defecto</option>
              {lists?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </Field>
          <Field label="Plazo de pago (días)" htmlFor="paymentTermsDays" error={errors.paymentTermsDays}>
            <Input {...bind('paymentTermsDays')} inputMode="numeric" />
          </Field>
          <Field label="Límite de crédito" htmlFor="creditLimit" error={errors.creditLimit}>
            <Input {...bind('creditLimit')} inputMode="decimal" />
          </Field>
        </CardContent>
      </Card>
      {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Guardando…' : 'Crear cliente'}</Button>
      </div>
    </form>
  );
}
