export interface LotBalance {
  stockItemId: string;
  lotId: string | null;
  expiresAt: Date | null;
  available: number;
}

export interface Allocation {
  stockItemId: string;
  lotId: string | null;
  quantity: number;
}

/**
 * First Expired, First Out: consume primero los lotes que vencen antes.
 * Lotes sin vencimiento van al final. Devuelve null si no alcanza el stock.
 */
export function allocateFefo(balances: LotBalance[], quantity: number): Allocation[] | null {
  const sorted = [...balances]
    .filter((b) => b.available > 0)
    .sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity));
  const allocations: Allocation[] = [];
  let pending = quantity;
  for (const b of sorted) {
    if (pending <= 0) break;
    const take = Math.min(b.available, pending);
    allocations.push({ stockItemId: b.stockItemId, lotId: b.lotId, quantity: take });
    pending -= take;
  }
  return pending > 1e-9 ? null : allocations;
}
