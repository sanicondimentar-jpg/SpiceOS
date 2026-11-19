import { round2 } from '../../shared/domain/money';

export interface OpenPurchase {
  id: string;
  date: Date;
  balance: number;
}

/**
 * Reparte un pago entre las compras elegidas, de la más vieja a la más nueva, sin pasarse del saldo de cada una.
 * Lo que sobra queda a cuenta (sin imputar).
 */
export function allocatePayment(amount: number, purchases: OpenPurchase[]): { allocations: { purchaseId: string; amount: number }[]; unallocated: number } {
  let left = round2(amount);
  const allocations: { purchaseId: string; amount: number }[] = [];
  const sorted = [...purchases].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
  for (const p of sorted) {
    if (left <= 0) break;
    const take = round2(Math.min(left, p.balance));
    if (take <= 0) continue;
    allocations.push({ purchaseId: p.id, amount: take });
    left = round2(left - take);
  }
  return { allocations, unallocated: left };
}

/** Estado de una compra según lo pagado (con tolerancia de un centavo). */
export function purchaseStatus(total: number, paid: number, cancelled: boolean) {
  if (cancelled) return 'CANCELLED' as const;
  if (paid <= 0.005) return 'UNPAID' as const;
  return total - paid <= 0.005 ? ('PAID' as const) : ('PARTIAL' as const);
}
