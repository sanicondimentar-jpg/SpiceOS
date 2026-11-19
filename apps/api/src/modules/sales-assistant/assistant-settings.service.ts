import { Injectable } from '@nestjs/common';
import type { AssistantSettingsInput } from '@spiceos/contracts';
import { env } from '../../shared/config/env';
import { BusinessRuleError, NotFoundError } from '../../shared/domain/errors';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { MANUAL_PAUSE } from '../messaging/conversations.service';
import { normalizeReceiptPhone } from '../receipts/supplier-phones';
import { SalesAssistantService } from './sales-assistant.service';

/** Configuración del asistente (Configuración → WhatsApp) y pausa por chat desde la bandeja. */
@Injectable()
export class AssistantSettingsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly assistant: SalesAssistantService,
  ) {}

  get() {
    return this.uow.read(async (tx) => {
      const a = await tx.whatsappAccount.findFirst();
      const catalog = await this.assistant.loadCatalog(tx);
      return {
        aiConfigured: !!env().ANTHROPIC_API_KEY,
        connected: !!a?.connectedAt,
        mode: a?.assistantMode ?? 'OFF',
        testPhones: a?.assistantTestPhones ?? [],
        minOrder: a ? Number(a.assistantMinOrder) : 50000,
        notes: a?.assistantNotes ?? null,
        catalogItems: catalog.length,
        catalogInStock: catalog.filter((c) => c.inStock).length,
      };
    });
  }

  async save(input: AssistantSettingsInput) {
    const testPhones = input.testPhones.map((p) => normalizeReceiptPhone(p)).filter((p): p is string => !!p);
    if (input.mode === 'TEST' && !testPhones.length) throw new BusinessRuleError('Para el modo prueba cargá al menos un teléfono de prueba');
    await this.uow.run(async (tx, scope) => {
      const a = await tx.whatsappAccount.findFirst({ select: { id: true, assistantMode: true } });
      if (!a) throw new BusinessRuleError('Primero conectá el número de WhatsApp');
      await tx.whatsappAccount.update({
        where: { id: a.id },
        data: { assistantMode: input.mode, assistantTestPhones: testPhones, assistantMinOrder: input.minOrder, assistantNotes: input.notes?.trim() || null },
      });
      scope.auditLog({ action: 'whatsapp_assistant.update', entityType: 'whatsapp_account', entityId: a.id, before: { mode: a.assistantMode }, after: { ...input, testPhones } });
    });
    return this.get();
  }

  /** pause: el asistente deja de contestar en ese chat hasta que lo reactiven. resume: vuelve a contestar. */
  setForConversation(id: string, action: 'pause' | 'resume') {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const c = await tx.conversation.findFirst({ where: { id }, select: { id: true } });
      if (!c) throw new NotFoundError('Conversación', id);
      await tx.conversation.update({
        where: { id },
        data:
          action === 'pause'
            ? { assistantHandoff: MANUAL_PAUSE, assistantHandoffAt: new Date() }
            : { assistantHandoff: null, assistantHandoffAt: null, assistantPausedUntil: null },
      });
      scope.auditLog({ action: `conversation.assistant_${action}`, entityType: 'conversation', entityId: id, after: { by: ctx.actor } });
      return { id };
    });
  }
}
