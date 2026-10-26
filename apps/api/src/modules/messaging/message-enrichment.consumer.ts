import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { MessageReceivedPayload } from '@spiceos/contracts';
import { EventBusService } from '../../shared/messaging/event-bus.service';
import { LlmService } from '../../shared/ai/llm.service';
import { UnitOfWork } from '../../shared/unit-of-work';
import { AggregateRoot } from '../../shared/domain/aggregate-root';
import { DomainEvent } from '../../shared/domain/domain-event';
import { env } from '../../shared/config/env';
import { isWorker } from '../../shared/process-role';
import { WhatsappClient } from './whatsapp.client';

const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['purchase_intent', 'price_request', 'complaint', 'payment_promise', 'other'] },
    score: { type: 'number' },
    summary: { type: 'string' },
    products: { type: 'array', items: { type: 'string' } },
  },
  required: ['intent', 'score', 'summary', 'products'],
  additionalProperties: false,
};

const INTENT_SYSTEM = `Clasificás mensajes de WhatsApp que clientes envían a una distribuidora de especias y condimentos en Argentina.
Devolvé la intención principal, una confianza entre 0 y 1, un resumen de una línea y los productos mencionados.
purchase_intent: quiere comprar o hacer un pedido. price_request: pide precios o lista. complaint: reclamo de calidad, entrega o facturación.
payment_promise: promete o informa un pago. other: cualquier otra cosa.`;

class Events extends AggregateRoot {
  emit(e: DomainEvent) {
    this.record(e);
  }
}

/** Worker: transcribe audios y detecta intención de cada mensaje entrante. */
@Injectable()
export class MessageEnrichmentConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(MessageEnrichmentConsumer.name);

  constructor(
    private readonly bus: EventBusService,
    private readonly uow: UnitOfWork,
    private readonly llm: LlmService,
    private readonly whatsapp: WhatsappClient,
  ) {}

  async onApplicationBootstrap() {
    if (!isWorker()) return;
    await this.bus.subscribe('messaging.enrichment', ['message.received'], (e) =>
      this.enrich(e.payload as unknown as MessageReceivedPayload),
    );
  }

  private async enrich(p: MessageReceivedPayload) {
    let text = p.text;
    if (p.type === 'audio') text = await this.transcribe(p.messageId);
    if (!text?.trim()) return;

    const result = await this.llm.extractJson<{ intent: string; score: number; summary: string; products: string[] }>(
      INTENT_SYSTEM,
      text,
      INTENT_SCHEMA,
    );

    await this.uow.run(async (tx, scope) => {
      await tx.message.update({ where: { id: p.messageId }, data: { intent: result.intent, intentScore: result.score } });
      if (result.intent !== 'other' && result.score >= 0.6) {
        const events = new Events();
        events.emit(new DomainEvent('intent.detected', 'conversation', p.conversationId, { ...p, text, ...result }));
        scope.track(events);
      }
    });
  }

  private async transcribe(messageId: string): Promise<string | null> {
    const sttUrl = env().STT_URL;
    if (!sttUrl) return null;
    const message = await this.uow.read((tx) =>
      tx.message.findUniqueOrThrow({ where: { id: messageId }, include: { conversation: { include: { account: true } } } }),
    );
    if (!message.mediaKey) return null;
    const media = await this.whatsapp.downloadMedia(message.conversation.account, message.mediaKey);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(media.data)], { type: media.mimeType }), 'audio.ogg');
    form.append('language', 'es');
    const res = await fetch(sttUrl, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Transcripción falló: ${res.status}`);
    const { text } = (await res.json()) as { text: string };
    await this.uow.run((tx) => tx.message.update({ where: { id: messageId }, data: { transcript: text } }));
    return text;
  }
}
