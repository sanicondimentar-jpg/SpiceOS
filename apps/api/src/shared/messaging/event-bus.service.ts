import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { ALL_PERMISSIONS, EventEnvelope } from '@spiceos/contracts';
import { env } from '../config/env';
import { RequestContextStore } from '../tenancy/request-context';

export const EVENTS_EXCHANGE = 'spiceos.events';
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 15_000;

export type EventHandler = (event: EventEnvelope) => Promise<void>;

/**
 * Bus de eventos sobre RabbitMQ (exchange topic).
 * Cada consumidor tiene su cola durable, una cola de reintento con TTL y una DLQ.
 * Los handlers corren dentro de un contexto de sistema del tenant del evento.
 */
@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.ConfirmChannel;

  private async ch(): Promise<amqp.ConfirmChannel> {
    if (this.channel) return this.channel;
    this.connection = await amqp.connect(env().RABBITMQ_URL);
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    await this.channel.prefetch(20);
    return this.channel;
  }

  async publish(event: EventEnvelope): Promise<void> {
    const ch = await this.ch();
    ch.publish(EVENTS_EXCHANGE, event.type, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      messageId: event.id,
      contentType: 'application/json',
      headers: { 'x-tenant-id': event.tenantId, 'x-correlation-id': event.correlationId },
    });
    await ch.waitForConfirms();
  }

  /** patterns: routing keys topic, ej. ["message.received", "order.*", "#"]. */
  async subscribe(queue: string, patterns: string[], handler: EventHandler): Promise<void> {
    const ch = await this.ch();
    const retry = `${queue}.retry`;
    const dlq = `${queue}.dlq`;
    await ch.assertQueue(dlq, { durable: true });
    await ch.assertQueue(retry, {
      durable: true,
      messageTtl: RETRY_DELAY_MS,
      deadLetterExchange: '',
      deadLetterRoutingKey: queue,
    });
    await ch.assertQueue(queue, { durable: true });
    for (const p of patterns) await ch.bindQueue(queue, EVENTS_EXCHANGE, p);

    await ch.consume(queue, async (msg) => {
      if (!msg) return;
      const event = JSON.parse(msg.content.toString()) as EventEnvelope;
      const attempt = Number(msg.properties.headers?.['x-attempt'] ?? 1);
      try {
        await RequestContextStore.run(systemContext(event), () => handler(event));
        ch.ack(msg);
      } catch (err) {
        this.logger.error(`${queue} falló evento ${event.type}/${event.id} (intento ${attempt})`, err as Error);
        const target = attempt >= MAX_ATTEMPTS ? dlq : retry;
        ch.sendToQueue(target, msg.content, {
          ...msg.properties,
          headers: { ...msg.properties.headers, 'x-attempt': attempt + 1, 'x-error': String(err) },
        });
        ch.ack(msg);
      }
    });
    this.logger.log(`Consumidor ${queue} escuchando ${patterns.join(', ')}`);
  }

  async onModuleDestroy() {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}

function systemContext(event: EventEnvelope) {
  return {
    tenantId: event.tenantId,
    userId: '00000000-0000-0000-0000-000000000000',
    actor: 'system:worker',
    actorType: 'SYSTEM' as const,
    roleKey: 'system',
    permissions: new Set(ALL_PERMISSIONS),
    branchScope: [],
    maxDiscount: 100,
    correlationId: event.correlationId ?? event.id,
  };
}
