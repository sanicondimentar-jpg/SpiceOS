import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';
import { RequestContextStore } from '../tenancy/request-context';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/** Registro append-only. Se escribe en la misma transacción que el cambio auditado. */
@Injectable()
export class AuditService {
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    const ctx = RequestContextStore.get();
    await tx.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorType: ctx.actorType,
        actorId: ctx.actor,
        onBehalfOf: ctx.onBehalfOf,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: toJson(entry.before),
        after: toJson(entry.after),
        ip: ctx.ip,
        correlationId: ctx.correlationId,
      },
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
