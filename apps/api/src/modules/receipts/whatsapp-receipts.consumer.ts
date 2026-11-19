import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { MessageReceivedPayload } from '@spiceos/contracts';
import { EventBusService } from '../../shared/messaging/event-bus.service';
import { isWorker } from '../../shared/process-role';
import { UnitOfWork } from '../../shared/unit-of-work';
import { WhatsappClient } from '../messaging/whatsapp.client';
import { PendingReceiptsService } from './pending-receipts.service';
import { isAuthorizedPhone } from './supplier-phones';

/**
 * Worker: si un proveedor manda por WhatsApp la foto o el PDF de un remito desde un teléfono
 * autorizado (Compras → Proveedores), se lee con IA y queda como ingreso por confirmar.
 * Fotos de cualquier otro número se ignoran acá (siguen en la bandeja como siempre).
 */
@Injectable()
export class WhatsappReceiptsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger(WhatsappReceiptsConsumer.name);

  constructor(
    private readonly bus: EventBusService,
    private readonly uow: UnitOfWork,
    private readonly whatsapp: WhatsappClient,
    private readonly pending: PendingReceiptsService,
  ) {}

  async onApplicationBootstrap() {
    if (!isWorker()) return;
    await this.bus.subscribe('receipts.whatsapp', ['message.received'], (e) => this.handle(e.payload as unknown as MessageReceivedPayload));
  }

  async handle(p: MessageReceivedPayload) {
    if (p.type !== 'image' && p.type !== 'document') return;
    const found = await this.uow.read(async (tx) => {
      const message = await tx.message.findFirst({ where: { id: p.messageId }, include: { conversation: { include: { account: true } } } });
      if (!message?.mediaKey) return null;
      const suppliers = await tx.supplier.findMany({ where: { isActive: true, NOT: { receiptPhones: { isEmpty: true } } }, select: { id: true, legalName: true, receiptPhones: true } });
      const supplier = suppliers.find((s) => isAuthorizedPhone(message.conversation.waContactId, s.receiptPhones));
      if (!supplier) return null;
      const already = await tx.pendingReceipt.findFirst({ where: { messageId: p.messageId }, select: { id: true } });
      return already ? null : { message, supplier };
    });
    if (!found) return;

    const { message, supplier } = found;
    const file = await this.whatsapp.downloadMedia(message.conversation.account, message.mediaKey!);
    const mediaType = file.mimeType.split(';')[0].trim().toLowerCase();
    if (!mediaType.startsWith('image/') && mediaType !== 'application/pdf') return;
    try {
      const { id, reading } = await this.pending.create({
        source: 'WHATSAPP',
        file: { data: file.data, mediaType },
        supplierId: supplier.id,
        sender: `+${message.conversation.waContactId}`,
        messageId: p.messageId,
        note: p.text ?? null,
      });
      this.logger.log(`Remito de ${supplier.legalName} por WhatsApp: por confirmar (${id}, ${reading.lines.length} renglones)`);
    } catch (e) {
      // Una foto que no es un remito o no se puede leer no frena al resto de los consumidores.
      this.logger.warn(`No se pudo leer el remito por WhatsApp de ${supplier.legalName}: ${(e as Error).message}`);
    }
  }
}
