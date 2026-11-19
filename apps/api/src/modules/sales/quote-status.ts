/** Estados de un presupuesto que todavía se pueden editar, enviar, rechazar o pasar a pedido. */
const OPEN = ['DRAFT', 'PENDING_APPROVAL', 'SENT', 'EXPIRED'];

export const isEditable = (status: string) => OPEN.includes(status);

/**
 * "Vencido" no se guarda: un presupuesto abierto cuya validez ya pasó se muestra vencido.
 * Se puede pasar a pedido igual (los precios se respetan) o editarlo para renovar la validez.
 */
export function displayStatus(status: string, validUntil: Date | null, today: string): string {
  if (!isEditable(status) || !validUntil) return status;
  return validUntil.toISOString().slice(0, 10) < today ? 'EXPIRED' : status;
}

/** Fecha de hoy en Argentina, AAAA-MM-DD. */
export function todayAr(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(now);
}

/** Válido hasta: hoy + días (incluye el último día). */
export function validUntilFrom(today: string, days: number): Date {
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000);
}
