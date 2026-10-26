import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DomainEvent } from '../domain/domain-event';
import type { Tx } from '../prisma/prisma.service';
import { RequestContextStore } from '../tenancy/request-context';

/** Guarda eventos de dominio en outbox_events dentro de la transacción del caso de uso. */
@Injectable()
export class OutboxService {
  async add(tx: Tx, events: DomainEvent[]): Promise<void> {
    if (!events.length) return;
    const ctx = RequestContextStore.get();
    await tx.outboxEvent.createMany({
      data: events.map((e) => ({
        id: e.id,
        tenantId: ctx.tenantId,
        type: e.type,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
        payload: { ...(e.payload as object), _actor: ctx.actor } as Prisma.InputJsonValue,
        occurredAt: e.occurredAt,
        correlationId: ctx.correlationId,
      })),
    });
  }
}
