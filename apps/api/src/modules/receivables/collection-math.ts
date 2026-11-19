import { round2 } from '../../shared/domain/money';

export interface OpenCharge {
  id: string;
  date: Date;
  dueDate: Date;
  balance: number;
}

const DAY_MS = 86_400_000;

/** Fecha de hoy en Argentina como "2026-11-19" (los vencimientos son días, no horas). */
export function todayAr(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
/** Días de `from` a `to` (ambos fechas sin hora). */
export const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY_MS);
/** "2026-12-10" → "10/12/2026". */
export const shortDay = (d: Date | string) => (typeof d === 'string' ? d : isoDay(d)).slice(0, 10).split('-').reverse().join('/');

/** Plazo de un cliente: el de su ficha si tiene uno, si no el general de cobranza. */
export const termsFor = (customerTermsDays: number, defaultDays: number) => (customerTermsDays > 0 ? customerTermsDays : defaultDays);

/**
 * Reparte un monto entre deudas, de la que vence primero a la última, sin pasarse del saldo de cada una.
 * Devuelve las imputaciones y lo que sobra (queda a cuenta). No modifica `charges`.
 */
export function allocate(amount: number, charges: OpenCharge[]): { allocations: { chargeId: string; amount: number }[]; unallocated: number } {
  let left = round2(amount);
  const allocations: { chargeId: string; amount: number }[] = [];
  const sorted = [...charges].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  for (const c of sorted) {
    if (left <= 0) break;
    const take = round2(Math.min(left, c.balance));
    if (take <= 0) continue;
    allocations.push({ chargeId: c.id, amount: take });
    left = round2(left - take);
  }
  return { allocations, unallocated: left };
}

/** Un cobro en dos partes (efectivo y en cuenta) sobre las mismas deudas: primero el efectivo. */
export function allocateParts(parts: { key: string; amount: number }[], charges: OpenCharge[]) {
  const balances = new Map(charges.map((c) => [c.id, c.balance]));
  return parts.map((p) => {
    const open = charges.map((c) => ({ ...c, balance: balances.get(c.id) ?? 0 }));
    const r = allocate(p.amount, open);
    for (const a of r.allocations) balances.set(a.chargeId, round2((balances.get(a.chargeId) ?? 0) - a.amount));
    return { key: p.key, ...r };
  });
}

export function chargeStatus(total: number, paid: number, cancelled: boolean) {
  if (cancelled) return 'CANCELLED' as const;
  if (paid <= 0.005) return 'UNPAID' as const;
  return total - paid <= 0.005 ? ('PAID' as const) : ('PARTIAL' as const);
}

/** Qué avisos le tocan hoy a una deuda con saldo. */
export function dueNotices(dueDate: Date, today: Date, daysBefore: number): ('OWNER_BEFORE' | 'OWNER_DUE' | 'CUSTOMER_DUE')[] {
  const left = daysBetween(today, dueDate);
  if (left <= 0) return ['OWNER_DUE', 'CUSTOMER_DUE'];
  if (left <= daysBefore) return ['OWNER_BEFORE'];
  return [];
}

/** Teléfono para mandar por WhatsApp: solo dígitos, y a los celulares argentinos les agrega el 9 si falta. */
export function waNumber(phone: string): string | null {
  let d = phone.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.length === 10) d = `549${d}`; // 11 7058-0234
  if (d.startsWith('54') && !d.startsWith('549') && d.length === 12) d = `549${d.slice(2)}`;
  return d;
}
