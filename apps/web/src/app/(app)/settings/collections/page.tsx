'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useCollectionSettings, useSaveCollectionSettings } from '@/lib/collections';

const OWNER_TEXT =
  'Hola, te aviso desde SpiceOS: el cliente {{1}} tiene un saldo de ${{2}} por {{3}} que vence el {{4}}. Podés ver la cuenta en el sistema.';
const CUSTOMER_TEXT =
  'Hola {{1}}, te recordamos que tenés un saldo pendiente de ${{2}} por {{3}}, con vencimiento el {{4}}. Si ya lo abonaste, desestimá este mensaje. ¡Muchas gracias!';

/** Configuración → Cobranza: plazo de pago y avisos automáticos por WhatsApp. */
export default function CollectionSettingsPage() {
  const { data, isLoading } = useCollectionSettings();
  const save = useSaveCollectionSettings();
  const [v, setV] = useState({ termsDays: '30', remindersEnabled: true, daysBefore: '10', notifyPhone: '', ownerTemplate: '', customerTemplate: '', templateLang: 'es_AR' });
  useEffect(() => {
    if (data)
      setV({
        termsDays: String(data.termsDays),
        remindersEnabled: data.remindersEnabled,
        daysBefore: String(data.daysBefore),
        notifyPhone: data.notifyPhone ?? '',
        ownerTemplate: data.ownerTemplate ?? '',
        customerTemplate: data.customerTemplate ?? '',
        templateLang: data.templateLang,
      });
  }, [data]);
  if (isLoading || !data) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  const terms = Number(v.termsDays);
  const before = Number(v.daysBefore);
  const valid = Number.isInteger(terms) && terms >= 0 && terms <= 365 && Number.isInteger(before) && before >= 1 && before <= 60;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/settings" className="text-sm text-muted-foreground hover:underline">← Configuración</Link>
      <h1 className="text-2xl font-semibold">Cobranza</h1>

      <Card>
        <CardHeader><CardTitle>Plazo de pago</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Días para pagar desde la entrega" htmlFor="c-terms" hint="Para los clientes que no tienen un plazo propio en su ficha. 0 = contado.">
            <Input id="c-terms" inputMode="numeric" value={v.termsDays} onChange={(e) => setV({ ...v, termsDays: e.target.value })} />
          </Field>
          <p className="text-sm text-muted-foreground sm:pt-6">
            Cada pedido entregado que no se cobró queda en la cuenta del cliente y vence a los días que pongas. Un cliente con deuda vencida puede hacer pedidos, pero el sistema avisa que no se entregan hasta regularizar.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Avisos por WhatsApp</CardTitle>
          <p className="text-sm text-muted-foreground">
            Todos los días a las 9: te avisa a vos los días que elijas antes de cada vencimiento, y al vencer te avisa a vos y le manda un recordatorio al cliente. Cada aviso sale una sola vez.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={v.remindersEnabled} onChange={(e) => setV({ ...v, remindersEnabled: e.target.checked })} /> Mandar los avisos automáticamente
          </label>
          <Field label="Tu celular (para los avisos internos)" htmlFor="c-phone" hint="Con código de área, por ejemplo 11 2345-6789.">
            <Input id="c-phone" inputMode="tel" value={v.notifyPhone} onChange={(e) => setV({ ...v, notifyPhone: e.target.value })} />
          </Field>
          <Field label="Días de aviso antes del vencimiento" htmlFor="c-before">
            <Input id="c-before" inputMode="numeric" value={v.daysBefore} onChange={(e) => setV({ ...v, daysBefore: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plantillas de Meta</CardTitle>
          <p className="text-sm text-muted-foreground">
            WhatsApp solo deja escribirle a alguien que no te escribió en las últimas 24 horas con un mensaje “plantilla” aprobado por Meta. Crealas en WhatsApp Manager → Plantillas de mensajes, categoría “Utilidad”, idioma Español (Argentina), con este texto, y poné acá el nombre que les diste. Mientras no estén, los avisos solo salen a los chats abiertos.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Plantilla del aviso para vos" htmlFor="c-owner" hint="Nombre sugerido: aviso_cobranza">
            <Input id="c-owner" placeholder="aviso_cobranza" value={v.ownerTemplate} onChange={(e) => setV({ ...v, ownerTemplate: e.target.value.trim() })} />
          </Field>
          <p className="rounded-md bg-muted p-3 text-xs">{OWNER_TEXT}</p>
          <Field label="Plantilla del recordatorio al cliente" htmlFor="c-customer" hint="Nombre sugerido: recordatorio_pago">
            <Input id="c-customer" placeholder="recordatorio_pago" value={v.customerTemplate} onChange={(e) => setV({ ...v, customerTemplate: e.target.value.trim() })} />
          </Field>
          <p className="rounded-md bg-muted p-3 text-xs">{CUSTOMER_TEXT}</p>
          <p className="text-xs text-muted-foreground">Ejemplos para Meta: {'{{1}}'} Rotisería La Salvadora, {'{{2}}'} 53.500, {'{{3}}'} pedido PED-000012, {'{{4}}'} 10/12/2026.</p>
          <Field label="Idioma de las plantillas" htmlFor="c-lang" hint="Código de Meta: es_AR para Español (Argentina).">
            <Input id="c-lang" className="w-32" value={v.templateLang} onChange={(e) => setV({ ...v, templateLang: e.target.value.trim() })} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {save.error && <p className="mr-auto text-sm text-destructive">{save.error.message}</p>}
        {save.isSuccess && <p className="mr-auto text-sm text-success">Guardado.</p>}
        <Button
          disabled={!valid || save.isPending}
          onClick={() =>
            save.mutate({
              termsDays: terms,
              remindersEnabled: v.remindersEnabled,
              daysBefore: before,
              notifyPhone: v.notifyPhone.trim() || null,
              ownerTemplate: v.ownerTemplate || null,
              customerTemplate: v.customerTemplate || null,
              templateLang: v.templateLang || 'es_AR',
            })
          }
        >
          {save.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </div>
  );
}
