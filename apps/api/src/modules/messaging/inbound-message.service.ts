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
import { nextStatus } from './message-status';

export interface WebhookPayload {
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id: string };
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: WaMessage[];
        /** Coexistencia: lo que se responde desde la app WhatsApp Business del celular. */
        message_echoes?: (WaMessage & { to: string })[];
        statuses?: WaStatus[];
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
  voice?: { id: string };
  image?: { id: string; caption?: string };
  video?: { id: string; caption?: string };
  sticker?: { id: string };
  document?: { id: string; filename?: string; caption?: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  reaction?: { emoji?: string };
  contacts?: { name?: { formatted_name?: string }; phones?: { phone?: string }[] }[];
}

interface WaStatus {
  id: string;
  status: string; // sent, delivered, read, failed
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

type Account = { id: string; tenantId: string; autoCreateCustomer: boolean };

class ConversationEvents extends AggregateRoot {
  emit(e: DomainEvent) {
    this.record(e);
  }
}

/** Texto legible de cualquier tipo de mensaje (lo que se ve en la bandeja). */
export function messageText(msg: WaMessage): string | null {
  if (msg.text?.body) return msg.text.body;
  const caption = msg.image?.caption ?? msg.video?.caption ?? msg.document?.caption;
  if (caption) return caption;
  if (msg.document?.filename) return msg.document.filename;
  if (msg.location) return [msg.location.name, msg.location.address].filter(Boolean).join(' · ') || `${msg.location.latitude}, ${msg.location.longitude}`;
  if (msg.button?.text) return msg.button.text;
  if (msg.interactive) return msg.interactive.button_reply?.title ?? msg.interactive.list_reply?.title ?? null;
  if (msg.reaction?.emoji) return msg.reaction.emoji;
  if (msg.contacts?.length) return msg.contacts.map((c) => [c.name?.formatted_name, c.phones?.[0]?.phone].filter(Boolean).join(' ')).join(', ');
  return null;
}

function mediaId(msg: WaMessage): string | null {
  return msg.audio?.id ?? msg.voice?.id ?? msg.image?.id ?? msg.video?.id ?? msg.sticker?.id ?? msg.document?.id ?? null;
}

/**
 * Registra cada mensaje una sola vez (idempotente por wa_message_id), lo asocia a un cliente por teléfono
 * y, si no existe, crea un lead (o un cliente prospecto si la cuenta lo tiene activado).
 * También guarda lo que se contesta desde el celular (coexistencia) y los avisos de entregado/leído.
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
      if (!value?.metadata) continue;
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
      for (const msg of value.messages ?? []) {
        const name = value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? null;
        await RequestContextStore.run(ctx, () => this.storeInbound(account, msg, name));
      }
      for (const echo of value.message_echoes ?? []) {
        await RequestContextStore.run(ctx, () => this.storeEcho(account, echo));
      }
      for (const status of value.statuses ?? []) await this.updateStatus(status);
    }
  }

  private async storeInbound(account: Account, msg: WaMessage, name: string | null) {
    const phone = normalizePhone(msg.from)!;
    if (await this.system.message.findUnique({ where: { waMessageId: msg.id }, select: { id: true } })) return; // Meta reintenta

    let customerId = await this.uow.read((tx) => this.crm.findIdByPhone(tx, phone));
    if (!customerId && account.autoCreateCustomer) {
      customerId = (await this.crm.createProspect(name ?? phone, phone)).id;
    }

    await this.uow.run(async (tx, scope) => {
      const sentAt = new Date(Number(msg.timestamp) * 1000);
      const window = new Date(sentAt.getTime() + 24 * 3600_000);
      const existing = await tx.conversation.findUnique({ where: { accountId_waContactId: { accountId: account.id, waContactId: phone } } });
      let leadId = existing?.leadId ?? null;
      if (!customerId && !existing?.customerId && !leadId) {
        const lead =
          (await tx.lead.findFirst({ where: { phone, status: { not: 'CONVERTED' } } })) ??
          (await tx.lead.create({ data: { tenantId: account.tenantId, name: name ?? phone, phone, source: 'whatsapp' } }));
        leadId = lead.id;
      }
      const conversation = existing
        ? await tx.conversation.update({
            where: { id: existing.id },
            data: {
              lastMessageAt: sentAt,
              windowExpiresAt: window,
              status: 'OPEN',
              unreadCount: { increment: 1 },
              ...(name && { contactName: name }),
              ...(customerId && !existing.customerId && { customerId }),
              ...(leadId && !existing.leadId && { leadId }),
            },
          })
        : await tx.conversation.create({
            data: {
              tenantId: account.tenantId,
              accountId: account.id,
              waContactId: phone,
              contactName: name,
              customerId,
              leadId,
              lastMessageAt: sentAt,
              windowExpiresAt: window,
              unreadCount: 1,
            },
          });
      const text = messageText(msg);
      const message = await tx.message.create({
        data: {
          tenantId: account.tenantId,
          conversationId: conversation.id,
          waMessageId: msg.id,
          direction: 'INBOUND',
          type: msg.type,
          body: text,
          mediaKey: mediaId(msg), // id de Meta: la bandeja lo descarga a pedido
          sentAt,
        },
      });
      const linkedCustomer = conversation.customerId;
      await tx.activity.create({
        data: {
          tenantId: account.tenantId,
          type: 'WHATSAPP',
          subject: text?.slice(0, 120) ?? `Mensaje ${msg.type}`,
          entityType: linkedCustomer ? 'customer' : 'lead',
          entityId: (linkedCustomer ?? conversation.leadId)!,
          occurredAt: sentAt,
          metadata: { conversationId: conversation.id, messageId: message.id },
        },
      });
      const events = new ConversationEvents();
      events.emit(
        new DomainEvent('message.received', 'conversation', conversation.id, {
          conversationId: conversation.id,
          messageId: message.id,
          customerId: linkedCustomer,
          leadId: conversation.leadId,
          type: msg.type,
          text,
        }),
      );
      scope.track(events);
    });
  }

  /** Respuesta enviada desde la app del celular: se guarda como saliente y el chat queda leído. */
  private async storeEcho(account: Account, msg: WaMessage & { to: string }) {
    const phone = normalizePhone(msg.to);
    if (!phone) return;
    if (await this.system.message.findUnique({ where: { waMessageId: msg.id }, select: { id: true } })) return;
    const customerId = await this.uow.read((tx) => this.crm.findIdByPhone(tx, phone));
    await this.uow.run(async (tx) => {
      const sentAt = new Date(Number(msg.timestamp) * 1000);
      const conversation = await tx.conversation.upsert({
        where: { accountId_waContactId: { accountId: account.id, waContactId: phone } },
        create: { tenantId: account.tenantId, accountId: account.id, waContactId: phone, customerId, lastMessageAt: sentAt },
        update: { lastMessageAt: sentAt, unreadCount: 0 },
      });
      await tx.message.create({
        data: {
          tenantId: account.tenantId,
          conversationId: conversation.id,
          waMessageId: msg.id,
          direction: 'OUTBOUND',
          type: msg.type,
          body: messageText(msg),
          mediaKey: mediaId(msg),
          status: 'SENT',
          sentBy: 'whatsapp-app',
          sentAt,
        },
      });
    });
  }

  /** Enviado → entregado → leído (o fallido). Los avisos pueden llegar desordenados: nunca se retrocede. */
  private async updateStatus(s: WaStatus) {
    const message = await this.system.message.findUnique({ where: { waMessageId: s.id }, select: { id: true, status: true } });
    if (!message) return;
    const status = nextStatus(message.status, s.status);
    if (status === message.status) return;
    const err = s.errors?.[0];
    await this.system.message.update({
      where: { id: message.id },
      data: { status, ...(err && { error: err.error_data?.details ?? err.message ?? err.title ?? `Error ${err.code}` }) },
    });
  }
}
