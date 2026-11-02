const ORDER = ['RECEIVED', 'PENDING', 'SENT', 'DELIVERED', 'READ'];

/** Estado de un mensaje saliente según el aviso de Meta. Llegan desordenados: nunca se retrocede. */
export function nextStatus(current: string, incoming: string): string {
  const next = incoming.toUpperCase();
  if (next === 'FAILED') return current === 'READ' || current === 'DELIVERED' ? current : 'FAILED';
  if (!ORDER.includes(next)) return current;
  if (current === 'FAILED') return next === 'SENT' ? current : next;
  return ORDER.indexOf(next) > ORDER.indexOf(current) ? next : current;
}
