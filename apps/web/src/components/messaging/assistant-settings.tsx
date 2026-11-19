'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAssistantSettings, useSaveAssistantSettings, type AssistantSettings } from '@/lib/messaging';
import { cn } from '@/lib/utils';

const MODES: { value: AssistantSettings['mode']; label: string; detail: string }[] = [
  { value: 'OFF', label: 'Apagado', detail: 'No responde a nadie. Todo se atiende a mano, como hasta ahora.' },
  { value: 'TEST', label: 'Prueba', detail: 'Solo les responde a los teléfonos de prueba. Ideal para probarlo escribiéndole vos.' },
  { value: 'ON', label: 'Encendido', detail: 'Les responde a todos los clientes que escriben (menos a los proveedores).' },
];

/** Configuración del asistente de ventas con IA (Configuración → WhatsApp). */
export function AssistantSettingsCard() {
  const { data, isLoading } = useAssistantSettings();
  const save = useSaveAssistantSettings();
  const [v, setV] = useState({ mode: 'OFF' as AssistantSettings['mode'], phones: '', minOrder: '50000', notes: '' });
  useEffect(() => {
    if (data) setV({ mode: data.mode, phones: data.testPhones.join('\n'), minOrder: String(data.minOrder), notes: data.notes ?? '' });
  }, [data]);

  if (isLoading || !data) return <Skeleton className="h-64" />;
  const testPhones = v.phones.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean);
  const canSave = !(v.mode === 'TEST' && !testPhones.length) && !(v.mode !== 'OFF' && !data.aiConfigured);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>3. Asistente de ventas (IA)</CardTitle>
          {data.mode === 'ON' ? <Badge tone="good">Encendido</Badge> : data.mode === 'TEST' ? <Badge tone="warn">En prueba</Badge> : <Badge>Apagado</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          Responde los WhatsApp de los clientes con el catálogo, los precios y el stock de SpiceOS, y los guía hasta armar el pedido. El pedido
          queda <b>Por revisar</b>: nunca se confirma solo. Si el cliente pide hablar con alguien, tiene un reclamo o algo que no sabe resolver,
          deja el chat marcado para una persona. Si alguien del equipo responde un chat, el asistente se calla ahí por 12 horas. Nunca les
          contesta a los teléfonos de proveedores.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.aiConfigured && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            Falta la clave de IA (ANTHROPIC_API_KEY) en el servidor. Hasta que se cargue, el asistente no puede encenderse.
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setV({ ...v, mode: m.value })}
              className={cn('rounded-md border p-3 text-left text-sm hover:bg-accent', v.mode === m.value && 'border-primary bg-primary/10')}
            >
              <div className="font-medium">{m.label}</div>
              <div className="text-xs text-muted-foreground">{m.detail}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Teléfonos de prueba (uno por renglón)" htmlFor="as-phones" hint="Con característica, ej. 11 5555-6666. Se usan en el modo Prueba.">
            <textarea
              id="as-phones"
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={v.phones}
              onChange={(e) => setV({ ...v, phones: e.target.value })}
            />
          </Field>
          <Field label="Pedido mínimo ($)" htmlFor="as-min" hint="El asistente no registra pedidos por debajo de este total.">
            <Input id="as-min" inputMode="numeric" value={v.minOrder} onChange={(e) => setV({ ...v, minOrder: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field
            label="Lo que el asistente puede contar"
            htmlFor="as-notes"
            hint="Días y horarios de entrega, formas de pago, demoras habituales. Lo que no esté acá, no lo promete: dice que lo confirma el equipo."
            className="sm:col-span-2"
          >
            <textarea
              id="as-notes"
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Ej.: Entregamos de lunes a viernes por la tarde. Se paga en efectivo o transferencia al recibir."
              value={v.notes}
              onChange={(e) => setV({ ...v, notes: e.target.value })}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Ofrece {data.catalogItems} productos activos de la lista mayorista (con los sueltos), {data.catalogInStock} con stock ahora. Zona: GBA Norte y alrededores.
        </p>
        <div className="flex items-center justify-end gap-2">
          {save.error && <p className="mr-auto text-sm text-destructive">{save.error.message}</p>}
          {save.isSuccess && <p className="mr-auto text-sm text-success">Guardado.</p>}
          <Button
            disabled={!canSave || save.isPending}
            onClick={() => save.mutate({ mode: v.mode, testPhones, minOrder: Number(v.minOrder || 0), notes: v.notes || null })}
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
