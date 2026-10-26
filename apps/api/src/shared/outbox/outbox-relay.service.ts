import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { EventEnvelope, EventType } from '@spiceos/contracts';
import { SystemPrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../messaging/event-bus.service';
import { isWorker } from '../process-role';

interface OutboxRow {
  id: string;
  tenant_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  correlation_id: string | null;
}

/**
 * Publica outbox_events en RabbitMQ. Varias réplicas pueden correr a la vez:
 * FOR UPDATE SKIP LOCKED reparte las filas sin duplicar.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly db: SystemPrismaService,
    private readonly bus: EventBusService,
  ) {}

  onApplicationBootstrap() {
    if (!isWorker()) return;
    this.timer = setInterval(() => void this.tick(), 500);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, tenant_id, type, aggregate_type, aggregate_id, payload, occurred_at, correlation_id
          FROM outbox_events
          WHERE published_at IS NULL AND attempts < 10
          ORDER BY occurred_at
          LIMIT 100
          FOR UPDATE SKIP LOCKED`;
        for (const row of rows) {
          const { _actor, ...payload } = row.payload;
          const envelope: EventEnvelope = {
            id: row.id,
            type: row.type as EventType,
            tenantId: row.tenant_id,
            aggregateType: row.aggregate_type,
            aggregateId: row.aggregate_id,
            occurredAt: row.occurred_at.toISOString(),
            correlationId: row.correlation_id ?? undefined,
            actor: _actor as string | undefined,
            payload,
          };
          try {
            await this.bus.publish(envelope);
            await tx.outboxEvent.update({ where: { id: row.id }, data: { publishedAt: new Date() } });
          } catch (err) {
            this.logger.warn(`No se pudo publicar ${row.id}: ${String(err)}`);
            await tx.outboxEvent.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
          }
        }
      });
    } finally {
      this.running = false;
    }
  }
}
