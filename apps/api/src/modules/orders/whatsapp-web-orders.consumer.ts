import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { MessageReceivedPayload } from '@spiceos/contracts';
import { EventBusService } from '../../shared/messaging/event-bus.service';
import { isWorker } from '../../shared/process-role';
import { UnitOfWork } from '../../shared/unit-of-work';
import { WebOrdersService } from './web-orders.service';
import { parseWebOrderMessage } from './whatsapp-web-order';

/**
 * Worker: si llega por WhatsApp un pedido armado en la web pero sin número (la web no lo pudo
 * registrar), lo carga igual como pedido "Por revisar". Así no se pierde aunque el sistema no
 * haya respondido en el momento en que el cliente confirmó.
 */
@Injectable()
export class WhatsappWebOrdersConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(WhatsappWebOrdersConsumer.name);

  constructor(
    private readonly bus: EventBusService,
    private readonly uow: UnitOfWork,
    private readonly webOrders: WebOrdersService,
  ) {}

  async onApplicationBootstrap() {
    if (!isWorker()) return;
    await this.bus.subscribe('orders.whatsapp-web', ['message.received'], (e) =>
      this.handle(e.payload as unknown as MessageReceivedPayload),
    );
  }

  async handle(p: MessageReceivedPayload) {
    if (!p.text?.includes('Sabor a Casa')) return;
    const conversation = await this.uow.read((tx) =>
      tx.conversation.findUnique({ where: { id: p.conversationId }, select: { waContactId: true } }),
    );
    const input = parseWebOrderMessage(p.text, conversation?.waContactId ?? '');
    if (!input) return;
    const order = await this.webOrders.receiveFromWhatsapp(input, p.messageId);
    if (order) this.logger.log(`Pedido web recibido por WhatsApp sin número: registrado como ${order.number}`);
  }
}
