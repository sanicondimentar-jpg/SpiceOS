'use client';

import { WEEKDAYS, WEEKDAY_LABEL, type Weekday } from '@spiceos/contracts';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { optText } from '@/lib/form';

type Values = Record<string, string>;
type Bind = (name: string) => Record<string, unknown> & { id: string };

/** Valores iniciales del formulario a partir de la ficha (o vacíos para un cliente nuevo). */
export function deliveryInitial(c?: {
  addresses?: { street: string; city: string; province: string; postalCode: string | null; deliveryNote: string | null }[];
  deliveryDays?: string[];
  deliveryHours?: string | null;
}): Values {
  const a = c?.addresses?.[0];
  return {
    street: a?.street ?? '',
    city: a?.city ?? '',
    province: a?.province ?? 'Buenos Aires',
    postalCode: a?.postalCode ?? '',
    deliveryNote: a?.deliveryNote ?? '',
    deliveryDays: (c?.deliveryDays ?? []).join(','),
    deliveryHours: c?.deliveryHours ?? '',
  };
}

export const toAddress = (v: Values) => ({
  street: v.street?.trim() ?? '',
  city: v.city?.trim() ?? '',
  province: optText(v.province) ?? 'Buenos Aires',
  postalCode: optText(v.postalCode),
  deliveryNote: optText(v.deliveryNote),
});

export const toDays = (v: Values) => (v.deliveryDays ? (v.deliveryDays.split(',') as Weekday[]) : []);

/** "Lun, Mié y Vie" — o "Lunes a viernes" si son corridos. */
export function formatDays(days: string[]): string {
  const sorted = WEEKDAYS.filter((d) => days.includes(d));
  if (!sorted.length) return '';
  const idx = sorted.map((d) => WEEKDAYS.indexOf(d));
  const consecutive = idx.every((n, i) => i === 0 || n === idx[i - 1] + 1);
  if (sorted.length >= 3 && consecutive) return `${WEEKDAY_LABEL[sorted[0]]} a ${WEEKDAY_LABEL[sorted.at(-1)!].toLowerCase()}`;
  const short = sorted.map((d) => WEEKDAY_LABEL[d].slice(0, 3));
  return short.length === 1 ? WEEKDAY_LABEL[sorted[0]] : `${short.slice(0, -1).join(', ')} y ${short.at(-1)}`;
}

/** Dirección principal (obligatoria) y días/horario en que atiende o recibe pedidos (opcionales). */
export function AddressAndDeliveryFields({
  bind,
  errors,
  values,
  setValues,
}: {
  bind: Bind;
  errors: Record<string, string>;
  values: Values;
  setValues: (fn: (v: Values) => Values) => void;
}) {
  const selected = toDays(values);
  const toggle = (d: Weekday) =>
    setValues((v) => {
      const days = toDays(v);
      const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
      return { ...v, deliveryDays: WEEKDAYS.filter((x) => next.includes(x)).join(',') };
    });

  return (
    <>
      <Field label="Dirección (calle y número)" htmlFor="street" error={errors['address.street'] ?? (errors.address && !errors['address.city'] ? errors.address : undefined)}>
        <Input {...bind('street')} autoComplete="street-address" />
      </Field>
      <Field label="Localidad" htmlFor="city" error={errors['address.city']} hint="Ej.: Martínez, San Isidro">
        <Input {...bind('city')} />
      </Field>
      <Field label="Provincia" htmlFor="province" error={errors['address.province']}>
        <Input {...bind('province')} />
      </Field>
      <Field label="Código postal (opcional)" htmlFor="postalCode" error={errors['address.postalCode']} hint="Ej.: 1640 o B1640ABC">
        <Input {...bind('postalCode')} autoComplete="postal-code" className="uppercase" />
      </Field>
      <Field label="Indicaciones para la entrega" htmlFor="deliveryNote" hint="Opcional: piso, timbre, entre calles">
        <Input {...bind('deliveryNote')} />
      </Field>
      <div className="space-y-1 sm:col-span-2">
        <span className="text-xs font-medium text-muted-foreground" id="deliveryDays-label">Días de atención o recepción de pedidos (opcional)</span>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="deliveryDays-label">
          {WEEKDAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={selected.includes(d)}
              onClick={() => toggle(d)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm',
                selected.includes(d) ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background hover:bg-muted',
              )}
            >
              {WEEKDAY_LABEL[d].slice(0, 3)}
            </button>
          ))}
        </div>
      </div>
      <Field label="Horario de atención o recepción (opcional)" htmlFor="deliveryHours" error={errors.deliveryHours} hint="Ej.: 8 a 12 y 16 a 19">
        <Input {...bind('deliveryHours')} />
      </Field>
    </>
  );
}
