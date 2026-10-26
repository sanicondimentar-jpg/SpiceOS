import type { Tx } from './prisma/prisma.service';
import { RequestContextStore } from './tenancy/request-context';

/** Numerador atómico por sucursal (fila bloqueada durante la transacción). */
export async function nextNumber(tx: Tx, branchId: string, key: string, defaultPrefix: string): Promise<string> {
  const { tenantId } = RequestContextStore.get();
  const [row] = await tx.$queryRaw<{ prefix: string; value: number }[]>`
    INSERT INTO sequences (tenant_id, branch_id, key, prefix, next)
    VALUES (${tenantId}::uuid, ${branchId}::uuid, ${key}, ${defaultPrefix}, 2)
    ON CONFLICT (tenant_id, branch_id, key) DO UPDATE SET next = sequences.next + 1
    RETURNING prefix, next - 1 AS value`;
  return `${row.prefix}${String(row.value).padStart(8, '0')}`;
}
