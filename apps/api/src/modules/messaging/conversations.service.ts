import { Injectable } from '@nestjs/common';
import type { ConversationListQuery, UpdateConversationInput } from '@spiceos/contracts';
import { Prisma } from '@prisma/client';
import { UnitOfWork } from '../../shared/unit-of-work';
import { BusinessRuleError, NotFoundError } from '../../shared/domain/errors';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { CrmFacade } from '../crm/crm.facade';
import { WhatsappClient } from './whatsapp.client';

/** Bandeja de WhatsApp: chats, respuesta desde el sistema y vínculo con clientes y pedidos. */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly whatsapp: WhatsappClient,
    private readonly crm: CrmFacade,
  ) {}

  list(query: ConversationListQuery) {
    return this.uow.read(async (tx) => {
      const q = query.q?.trim();
      const digits = q?.replace(/\D/g, '');
      const where: Prisma.ConversationWhereInput = {
        ...(query.status !== 'ALL' && { status: query.status === 'OPEN' ? { not: 'CLOSED' } : 'CLOSED' }),
        ...(q && {
          OR: [
            { contactName: { contains: q, mode: 'insensitive' } },
            ...(digits && digits.length >= 3 ? [{ waContactId: { contains: digits } }] : []),
            { customer: { legalName: { contains: q, mode: 'insensitive' } } },
            { customer: { tradeName: { contains: q, mode: 'insensitive' } } },
          ],
        }),
      };
      const [rows, unread] = await Promise.all([
        tx.conversation.findMany({
          where,
          orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
          take: 200,
          include: {
            customer: { select: { id: true, legalName: true, tradeName: true } },
            messages: { orderBy: { sentAt: 'desc' }, take: 1, select: { body: true, type: true, direction: true, transcript: true } },
          },
        }),
        tx.conversation.aggregate({ where: { status: { not: 'CLOSED' } }, _sum: { unreadCount: true } }),
      ]);
      const now = new Date();
      return {
        unread: unread._sum.unreadCount ?? 0,
        items: rows.map((c) => ({
          id: c.id,
          phone: c.waContactId,
          contactName: c.contactName,
          customer: c.customer && { id: c.customer.id, name: c.customer.tradeName ?? c.customer.legalName },
          status: c.status,
          unreadCount: c.unreadCount,
          lastMessageAt: c.lastMessageAt,
          windowOpen: !!c.windowExpiresAt && c.windowExpiresAt > now,
          lastMessage: c.messages[0]
            ? { text: c.messages[0].body ?? c.messages[0].transcript, type: c.messages[0].type, direction: c.messages[0].direction }
            : null,
        })),
      };
    });
  }

  /** Total de chats sin leer (para el aviso del menú). */
  unread() {
    return this.uow.read(async (tx) => {
      const r = await tx.conversation.aggregate({ where: { status: { not: 'CLOSED' } }, _sum: { unreadCount: true } });
      return { unread: r._sum.unreadCount ?? 0 };
    });
  }

  get(id: string) {
    return this.uow.read(async (tx) => {
      const c = await tx.conversation.findFirst({
        where: { id },
        include: {
          customer: { select: { id: true, code: true, legalName: true, tradeName: true, phone: true, status: true } },
          messages: { orderBy: { sentAt: 'desc' }, take: 300 },
        },
      });
      if (!c) throw new NotFoundError('Conversación', id);
      const userIds = [...new Set(c.messages.map((m) => m.sentBy).filter((s): s is string => !!s && /^[0-9a-f-]{36}$/.test(s)))];
      const [users, orders] = await Promise.all([
        userIds.length ? tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [],
        c.customerId
          ? tx.salesOrder.findMany({
              where: { customerId: c.customerId },
              orderBy: { createdAt: 'desc' },
              take: 8,
              select: { id: true, number: true, status: true, total: true, taxTotal: true, createdAt: true },
            })
          : [],
      ]);
      const names = new Map(users.map((u) => [u.id, u.fullName]));
      return {
        id: c.id,
        phone: c.waContactId,
        contactName: c.contactName,
        status: c.status,
        leadId: c.leadId,
        windowExpiresAt: c.windowExpiresAt,
        windowOpen: !!c.windowExpiresAt && c.windowExpiresAt > new Date(),
        customer: c.customer && {
          id: c.customer.id,
          code: c.customer.code,
          name: c.customer.tradeName ?? c.customer.legalName,
          status: c.customer.status,
        },
        orders: orders.map((o) => ({ ...o, total: Number(o.total) + Number(o.taxTotal), taxTotal: undefined })),
        messages: c.messages.reverse().map((m) => ({
          id: m.id,
          direction: m.direction,
          type: m.type,
          text: m.body,
          transcript: m.transcript,
          hasMedia: !!m.mediaKey,
          status: m.status,
          error: m.error,
          intent: m.intent,
          sentAt: m.sentAt,
          sentBy: m.sentBy === 'whatsapp-app' ? 'Celular' : m.sentBy?.startsWith('agent:') ? 'Copiloto' : (m.sentBy && names.get(m.sentBy)) ?? null,
        })),
      };
    });
  }

  /** Responde dentro de la ventana de 24 h desde el último mensaje del cliente (regla de Meta). */
  async send(id: string, text: string) {
    const ctx = RequestContextStore.get();
    const conv = await this.uow.read((tx) => tx.conversation.findFirst({ where: { id }, include: { account: true } }));
    if (!conv) throw new NotFoundError('Conversación', id);
    if (!conv.windowExpiresAt || conv.windowExpiresAt < new Date()) {
      throw new BusinessRuleError(
        'Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo deja escribirle con una plantilla aprobada, o esperar a que vuelva a escribir',
      );
    }
    let waId: string;
    try {
      waId = await this.whatsapp.sendText(conv.account, conv.waContactId, text);
    } catch (e) {
      throw new BusinessRuleError(`WhatsApp no aceptó el mensaje: ${(e as Error).message.replace(/^WhatsApp: /, '')}`);
    }
    return this.uow.run(async (tx, scope) => {
      const now = new Date();
      const m = await tx.message.create({
        data: {
          tenantId: ctx.tenantId,
          conversationId: id,
          waMessageId: waId,
          direction: 'OUTBOUND',
          type: 'text',
          body: text,
          status: 'SENT',
          sentBy: ctx.actor,
          sentAt: now,
        },
      });
      await tx.conversation.update({ where: { id }, data: { lastMessageAt: now, unreadCount: 0, status: 'OPEN' } });
      scope.auditLog({ action: 'message.send', entityType: 'conversation', entityId: id, after: { messageId: m.id } });
      return { id: m.id, waMessageId: waId };
    });
  }

  markRead(id: string) {
    return this.uow.run(async (tx) => {
      const r = await tx.conversation.updateMany({ where: { id }, data: { unreadCount: 0 } });
      if (!r.count) throw new NotFoundError('Conversación', id);
      return { id };
    });
  }

  update(id: string, input: UpdateConversationInput) {
    return this.uow.run(async (tx, scope) => {
      const c = await tx.conversation.findFirst({ where: { id } });
      if (!c) throw new NotFoundError('Conversación', id);
      if (input.customerId && !(await tx.customer.findFirst({ where: { id: input.customerId, deletedAt: null }, select: { id: true } }))) {
        throw new NotFoundError('Cliente', input.customerId);
      }
      await tx.conversation.update({
        where: { id },
        data: {
          ...(input.customerId !== undefined && { customerId: input.customerId }),
          ...(input.status && { status: input.status, ...(input.status === 'CLOSED' && { unreadCount: 0 }) }),
        },
      });
      scope.auditLog({ action: 'conversation.update', entityType: 'conversation', entityId: id, before: { customerId: c.customerId, status: c.status }, after: input });
      return { id };
    });
  }

  /** Da de alta como cliente (prospecto) al contacto del chat y lo vincula. */
  async createCustomer(id: string) {
    const c = await this.uow.read((tx) => tx.conversation.findFirst({ where: { id } }));
    if (!c) throw new NotFoundError('Conversación', id);
    if (c.customerId) throw new BusinessRuleError('El chat ya está vinculado a un cliente');
    const customer = await this.crm.createProspect(c.contactName ?? c.waContactId, c.waContactId);
    await this.uow.run(async (tx) => {
      await tx.conversation.update({ where: { id }, data: { customerId: customer.id } });
      if (c.leadId) await tx.lead.updateMany({ where: { id: c.leadId }, data: { status: 'CONVERTED', convertedCustomerId: customer.id } });
    });
    return customer;
  }

  /** Foto, audio o documento: se baja de Meta en el momento (Meta lo guarda unos 30 días). */
  async media(messageId: string) {
    const m = await this.uow.read((tx) =>
      tx.message.findFirst({ where: { id: messageId }, include: { conversation: { include: { account: true } } } }),
    );
    if (!m?.mediaKey) throw new NotFoundError('Archivo del mensaje', messageId);
    try {
      return await this.whatsapp.downloadMedia(m.conversation.account, m.mediaKey);
    } catch {
      throw new BusinessRuleError('WhatsApp ya no tiene ese archivo (se borran a los 30 días)');
    }
  }
}
