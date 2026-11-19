/** Reglas puras de las hojas de ruta (sin base de datos), testeables por separado. */

export type StopStatus = 'SCHEDULED' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED';

/** Para salir a repartir todos los pedidos tienen que estar listos (o despachados, si es un segundo intento). */
export function notReadyToLeave(orders: { number: string; status: string }[]): string[] {
  return orders.filter((o) => o.status !== 'READY' && o.status !== 'DISPATCHED').map((o) => o.number);
}

/** La hoja termina cuando ninguna parada sigue en camino o programada. */
export function routeDone(stops: { status: string }[]): boolean {
  return stops.length > 0 && stops.every((s) => s.status === 'DELIVERED' || s.status === 'FAILED');
}

/** Zona para agrupar: la localidad de la dirección, con mayúscula inicial ("vicente lopez" → "Vicente Lopez"). */
export function zoneOf(city: string | null | undefined): string {
  const c = (city ?? '').trim().replace(/\s+/g, ' ');
  if (!c) return 'Sin dirección';
  return c
    .toLowerCase()
    .split(' ')
    .map((w) => (w.length > 2 || w === c.toLowerCase() ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Link a Google Maps con la dirección (abre la app en el celular). */
export function mapsUrl(a: { street: string; city: string; province: string } | null): string | null {
  if (!a) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a.street}, ${a.city}, ${a.province}, Argentina`)}`;
}
