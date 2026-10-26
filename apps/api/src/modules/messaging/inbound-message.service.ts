import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ALL_PERMISSIONS } from '@spiceos/contracts';
import { SystemPrismaService } from '../../shared/prisma/prisma.service';
import { UnitOfWork } from '../../shared/unit-of-work';
import { AggregateRoot } from '../../shared/domain/aggregate-root';
import { DomainEvent } from '../../shared/domain/domain-event';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { CrmFacade } from '../crm/crm.facade';
import { normalizePhone } from '../crm/domain/customer';

export interface WebhookPayload {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id: string };
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: WaMessage[];
        statuses?: { id: string; status: string }[];
      };
    }[];
  }[];
}

interface WaMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  audio?: { id: string };
  image?: { id: string; caption?: string };
  document?: { id: string; filename?: string; caption?: string };
}

class ConversationEvents extends AggregateRoot {
  emit(e: DomainEvent) {
    this.record(e);
  }
}

/**
 * Registra cada mensaje entrante una sola vez (idempotente por wa_message_id),
 * lo asocia a un cliente por teléfono y, si no existe, crea un lead o un cliente prospecto.
 */
@Injectable()
export class InboundMessageService {
  private readonly logger = new Logger(InboundMessageService.name);

  constructor(
    private readonly system: SystemPrismaService,
    private readonly uow: UnitOfWork,
    private readonly crm: CrmFacade,
  ) {}

  async handle(payload: WebhookPayload): Promise<void> {
    for (const change of payload.entry?.flatMap((e) => e.changes ?? []) ?? []) {
      const value = change.value;
      if (!value?.metadata || !value.messages?.length) continue;
      const account = await this.system.whatsappAccount.findUnique({ where: { phoneNumberId: value.metadata.phone_number_id } });
      if (!account) {
        this.logger.warn(`Número de WhatsApp no registrado: ${value.metadata.phone_number_id}`);
        continue;
      }
      const ctx = {
        tenantId: account.tenantId,
        userId: '00000000-0000-0000-0000-000000000000',
        actor: 'integration:whatsapp',
        actorType: 'INTEGRATION' as const,
        roleKey: 'system',
        permissions: new Set(ALL_PERMISSIONS),
        branchScope: [],
        maxDiscount: 0,
        correlationId: randomUUID(),
      };
      for (const msg of value.messages) {
        const name = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? null;
        await RequestContextStore.run(ctx, () => this.store(account, msg, name));
      }
    }
  }

  private async store(account: { id: string; tenantId: string; autoCreateCustomer: boolean }, msg: WaMessage, name: string | null) {
    const phone = normalizePhone(msg.from)!;
    const exists = await this.system.message.findUnique({ where: { waMessageId: msg.id } });
    if (exists) return; // Meta reintenta webhooks: idempotencia

    let customerId = await this.uow.read((tx) => this.crm.findIdByPhone(tx, phone));
    if (!customerId && account.autoCreateCustomer) {
      customerId = (await this.crm.createProspect(name ?? phone, phone)).id;
    }

    await this.uow.run(async (tx, scope) => {
      let leadId: string | null = null;
      if (!customerId) {
        const lead =
          (await tx.lead.findFirst({ where: { phone, status: { not: 'CONVERTED' } } })) ??
          (await tx.lead.create({ data: { tenantId: account.tenantId, name: name ?? phone, phone, source: 'whatsapp' } }));
        leadId = lead.id;
      }
      const sentAt = new Date(Number(msg.timestamp) * 1000);
      const conversation = await tx.conversation.upsert({
        where: { accountId_waContactId: { accountId: account.id, waContactId: phone } },
        create: {
          tenantId: account.tenantId,
          accountId: account.id,
          waContactId: phone,
          contactName: name,
          customerId,
          leadId,
          lastMessageAt: sentAt,
          windowExpiresAt: new Date(sentAt.getTime() + 24 * 3600_000),
        },
        update: {
          lastMessageAt: sentAt,
          windowExpiresAt: new Date(sentAt.getTime() + 24 * 3600_000),
          status: 'OPEN',
          ...(customerId && { customerId }),
        },
      });
      const text = msg.text?.body ?? msg.image?.caption ?? msg.document?.caption ?? null;
      const message = await tx.message.create({
        data: {
          tenantId: account.tenantId,
          conversationId: conversation.id,
          waMessageId: msg.id,
          direction: 'INBOUND',
          type: msg.type,
          body: text,
          mediaKey: msg.audio?.id ?? msg.image?.id ?? msg.document?.id ?? null, // id de Meta hasta descargarlo a MinIO
          sentAt,
        },
      });
      await tx.activity.create({
        data: {
          tenantId: account.tenantId,
          type: 'WHATSAPP',
          subject: text?.slice(0, 120) ?? `Mensaje ${msg.type}`,
          entityType: customerId ? 'customer' : 'lead',
          entityId: (customerId ?? leadId)!,
          occurredAt: sentAt,
          metadata: { conversationId: conversation.id, messageId: message.id },
        },
      });
      const events = new ConversationEvents();
      events.emit(
        new DomainEvent('message.received', 'conversation', conversation.id, {
          conversationId: conversation.id,
          messageId: message.id,
          customerId,
          leadId,
          type: msg.type,
          text,
        }),
      );
      scope.track(events);
    });
  }
}
