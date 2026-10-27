'use client';

import { useState } from 'react';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Formulario mínimo validado con los mismos esquemas zod que usa la API.
 * Los valores se guardan como texto; `parse` los convierte antes de validar.
 */
export function useZodForm<T>(schema: ZodType<T, ZodTypeDef, unknown>, initial: Record<string, string>, parse: (v: Record<string, string>) => unknown) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const bind = (name: string) => ({
    id: name,
    name,
    value: values[name] ?? '',
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value })),
    'aria-invalid': errors[name] ? true : undefined,
  });

  /** Devuelve los datos validados o null (y deja los errores por campo). */
  const validate = (): T | null => {
    const result = schema.safeParse(parse(values));
    if (result.success) {
      setErrors({});
      return result.data;
    }
    const next: Record<string, string> = {};
    for (const issue of result.error.issues) next[String(issue.path[0])] ??= issue.message;
    setErrors(next);
    return null;
  };

  return { values, setValues, errors, bind, validate, reset: () => setValues(initial) };
}

/** "" → undefined; "1.234,5" → 1234.5 */
export const optText = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);
export const optNumber = (s: string | undefined) => {
  if (!s || !s.trim()) return undefined;
  const t = /,\d+$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(t.replace(/[$\s%]/g, ''));
  return Number.isFinite(n) ? n : Number.NaN;
};
