import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS } from '@spiceos/contracts';
import { AiTool } from '../../shared/ai/ai-tool.decorator';
import { UnitOfWork } from '../../shared/unit-of-work';
import { BusinessRuleError } from '../../shared/domain/errors';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { WhatsappClient } from './whatsapp.client';

@Injectable()
export class MessagingAiTools {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly whatsapp: WhatsappClient,
  ) {}

  @AiTool({
    name: 'messaging_conversations_of_day',
    description:
      'Devuelve los mensajes de WhatsApp de un día agrupados por conversación (cliente o lead, texto o transcripción, intención detectada) para resumirlos. Responde "resume las conversaciones del día".',
    input: z.object({ date: z.string().date().optional().describe('YYYY-MM-DD; por defecto hoy') }),
    permissions: [PERMISSIONS.messaging.read],
    agents: ['commercial', 'executive'],
  })
  conversationsOfDay({ date }: { date?: string }) {
    const day = date ?? new Date().toISOString().slice(0, 10);
    return this.uow.read((tx) =>
      tx.$queryRaw`
        SELECT c.id AS conversation_id, coalesce(cu.legal_name, c.contact_name, c.wa_contact_id) AS contact,
               json_agg(json_build_object(
                 'at', m.sent_at, 'direction', m.direction,
                 'text', coalesce(m.body, m.transcript), 'intent', m.intent) ORDER BY m.sent_at) AS messages
        FROM conversations c
        JOIN messages m ON m.conversation_id = c.id
        LEFT JOIN customers cu ON cu.id = c.customer_id
        WHERE m.sent_at >= ${day}::date AND m.sent_at < ${day}::date + 1
        GROUP BY c.id, cu.legal_name
        ORDER BY max(m.sent_at) DESC
        LIMIT 100`,
    );
  }

  @AiTool({
    name: 'messaging_send_whatsapp',
    description:
      'Envía un mensaje de WhatsApp a una conversación existente. Solo dentro de la ventana de 24 h desde el último mensaje del cliente. Mostrá el texto al usuario y pedí confirmación antes de usarla.',
    input: z.object({ conversationId: z.string().uuid(), text: z.string().min(1).max(4000) }),
    permissions: [PERMISSIONS.messaging.send],
    write: true,
    requiresConfirmation: true,
    agents: ['commercial', 'collections'],
  })
  async send({ conversationId, text }: { conversationId: string; text: string }) {
    const ctx = RequestContextStore.get();
    const conv = await this.uow.read((tx) =>
      tx.conversation.findUniqueOrThrow({ where: { id: conversationId }, include: { account: true } }),
    );
    if (!conv.windowExpiresAt || conv.windowExpiresAt < new Date()) {
      throw new BusinessRuleError('La ventana de 24 h está cerrada: hay que usar una plantilla aprobada');
    }
    const waId = await this.whatsapp.sendText(conv.account, conv.waContactId, text);
    await this.uow.run(async (tx, scope) => {
      const m = await tx.message.create({
        data: {
          tenantId: ctx.tenantId,
          conversationId,
          waMessageId: waId,
          direction: 'OUTBOUND',
          type: 'text',
          body: text,
          status: 'SENT',
          sentBy: ctx.actor,
          sentAt: new Date(),
        },
      });
      scope.auditLog({ action: 'message.send', entityType: 'conversation', entityId: conversationId, after: { messageId: m.id } });
    });
    return { sent: true, waMessageId: waId };
  }
}
