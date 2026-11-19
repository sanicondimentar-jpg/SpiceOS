import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import type { MessageReceivedPayload } from '@spiceos/contracts';
import { EventBusService } from '../../shared/messaging/event-bus.service';
import { isWorker } from '../../shared/process-role';
import { SalesAssistantService } from './sales-assistant.service';

/** Worker: cada mensaje que entra por WhatsApp pasa por el asistente, que decide si contesta. */
@Injectable()
export class SalesAssistantConsumer implements OnApplicationBootstrap {
  constructor(
    private readonly bus: EventBusService,
    private readonly assistant: SalesAssistantService,
  ) {}

  async onApplicationBootstrap() {
    if (!isWorker()) return;
    await this.bus.subscribe('assistant.whatsapp', ['message.received'], async (e) => {
      const p = e.payload as unknown as MessageReceivedPayload;
      // No se espera: la espera (mensajes seguidos, transcripción) no frena a los otros chats.
      void this.assistant.onMessage(p.conversationId, p.messageId, p.type);
    });
  }
}
