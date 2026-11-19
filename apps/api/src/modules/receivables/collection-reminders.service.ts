import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { ALL_PERMISSIONS } from '@spiceos/contracts';
import { BusinessRuleError, NotFoundError } from '../../shared/domain/errors';
import { round2 } from '../../shared/domain/money';
import { SystemPrismaService, type Tx } from '../../shared/prisma/prisma.service';
import { isScheduler } from '../../shared/process-role';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { WhatsappClient } from '../messaging/whatsapp.client';
import { asDate, daysBetween, dueNotices, shortDay, todayAr, waNumber } from './collection-math';
import { CollectionsService, type Settings } from './collections.service';

const SENDER = 'system:cobranza';
const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const plain = (n: number) => Math.round(n).toLocaleString('es-AR');

interface OpenItem {
  id: string;
  customerId: string;
  customer: string;
  phone: string | null;
  label: string;
  dueDate: Date;
  balance: number;
  done: Set<string>;
}

/**
 * Avisos de cobranza por WhatsApp, todos los días a las 9 (hora argentina):
 * - a quien cobra (Nacho), los días configurados antes del vencimiento (10);
 * - al vencer, a quien cobra y al cliente.
 * Cada aviso sale una sola vez por deuda; si falla se reintenta al día siguiente.
 * Fuera de la ventana de 24 h de Meta solo se puede escribir con una plantilla aprobada.
 */
@Injectable()
export class CollectionRemindersService {
  private readonly logger = new Logger(CollectionRemindersService.name);

  constructor(
    private readonly system: SystemPrismaService,
    private readonly uow: UnitOfWork,
    private readonly whatsapp: WhatsappClient,
    private readonly collections: CollectionsService,
  ) {}

  @Cron('0 12 * * *') // 9:00 en Argentina
  async daily(): Promise<void> {
    if (!isScheduler()) return;
    const accounts = await this.system.whatsappAccount.findMany({ where: { connectedAt: { not: null } }, select: { tenantId: true } });
    for (const tenantId of new Set(accounts.map((a) => a.tenantId))) {
      await RequestContextStore.run(ctxFor(tenantId), () =>
        this.run().catch((e) => this.logger.error(`Avisos de cobranza: ${(e as Error).message}`)),
      );
    }
  }

  /** Corre los avisos del día para la empresa actual (también desde el botón "Mandar avisos ahora"). */
  async run(): Promise<{ sent: number; failed: number; pending: string[] }> {
    const { settings, items } = await this.uow.read(async (tx) => ({ settings: await this.collections.settings(tx), items: await this.openItems(tx) }));
    const pending: string[] = [];
    if (!settings.remindersEnabled) return { sent: 0, failed: 0, pending: ['Los avisos automáticos están apagados'] };
    const connected = await this.uow.read((tx) => tx.whatsappAccount.count({ where: { connectedAt: { not: null } } }));
    if (!connected) return { sent: 0, failed: 0, pending: ['WhatsApp no está conectado'] };
    if (!settings.notifyPhone) pending.push('Falta el teléfono para avisos en Configuración → Cobranza');
    const today = asDate(todayAr());
    let sent = 0;
    let failed = 0;
    for (const item of items) {
      for (const kind of dueNotices(item.dueDate, today, settings.daysBefore)) {
        if (item.done.has(kind)) continue;
        const toCustomer = kind === 'CUSTOMER_DUE';
        const phone = toCustomer ? item.phone : settings.notifyPhone;
        if (!phone) {
          if (toCustomer) await this.record(item.id, kind, 'SKIPPED', null, 'El cliente no tiene teléfono');
          continue;
        }
        try {
          await this.send(settings, phone, toCustomer ? customerMessage(item, today) : ownerMessage(item, today, kind), toCustomer ? item.customerId : null);
          await this.record(item.id, kind, 'SENT', phone, null);
          sent++;
        } catch (e) {
          await this.record(item.id, kind, 'FAILED', phone, (e as Error).message);
          failed++;
        }
      }
    }
    if (sent || failed) this.logger.log(`Avisos de cobranza: ${sent} enviados, ${failed} con error`);
    return { sent, failed, pending };
  }

  /** Recordatorio al cliente a pedido (botón en la cuenta del cliente). */
  async remindCustomer(chargeId: string) {
    const { settings, item } = await this.uow.read(async (tx) => ({
      settings: await this.collections.settings(tx),
      item: (await this.openItems(tx, chargeId))[0],
    }));
    if (!item) throw new NotFoundError('Deuda con saldo', chargeId);
    if (!item.phone) throw new BusinessRuleError('El cliente no tiene teléfono en la ficha');
    try {
      await this.send(settings, item.phone, customerMessage(item, asDate(todayAr())), item.customerId);
    } catch (e) {
      throw new BusinessRuleError((e as Error).message);
    }
    await this.record(item.id, 'CUSTOMER_MANUAL', 'SENT', item.phone, null, true);
    return { ok: true };
  }

  private async openItems(tx: Tx, chargeId?: string): Promise<OpenItem[]> {
    const rows = await tx.customerCharge.findMany({
      where: { cancelledAt: null, ...(chargeId && { id: chargeId }) },
      include: {
        allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } },
        customer: { select: { legalName: true, tradeName: true, phone: true } },
        notices: { where: { status: { in: ['SENT', 'SKIPPED'] } }, select: { kind: true } },
      },
    });
    return rows
      .map((c) => ({
        id: c.id,
        customerId: c.customerId,
        customer: c.customer.tradeName ?? c.customer.legalName,
        phone: c.customer.phone,
        label: c.description ? c.description.charAt(0).toLowerCase() + c.description.slice(1) : 'saldo anterior',
        dueDate: c.dueDate,
        balance: round2(Number(c.total) - c.allocations.reduce((s, a) => s + Number(a.amount), 0)),
        done: new Set(c.notices.map((n) => n.kind)),
      }))
      .filter((c) => c.balance > 0.005);
  }

  /** Texto libre si el chat está abierto (últimas 24 h); si no, la plantilla aprobada. Queda en la bandeja. */
  private async send(settings: Settings, phone: string, msg: { text: string; template: 'owner' | 'customer'; params: string[] }, customerId: string | null) {
    const to = waNumber(phone);
    if (!to) throw new Error(`Teléfono inválido: ${phone}`);
    const account = await this.uow.read((tx) => tx.whatsappAccount.findFirst({ where: { connectedAt: { not: null } } }));
    if (!account) throw new Error('WhatsApp no está conectado');
    const conv = await this.uow.read(async (tx) => {
      const candidates = await tx.conversation.findMany({ where: { accountId: account.id, waContactId: { endsWith: to.slice(-10) } }, orderBy: { lastMessageAt: 'desc' }, take: 1 });
      return candidates[0] ?? null;
    });
    const waContact = conv?.waContactId ?? to;
    const open = !!conv?.windowExpiresAt && conv.windowExpiresAt > new Date();
    const template = msg.template === 'owner' ? settings.ownerTemplate : settings.customerTemplate;
    let waId: string;
    let body: string;
    if (open) {
      waId = await this.whatsapp.sendText(account, waContact, msg.text);
      body = msg.text;
    } else if (template) {
      waId = await this.whatsapp.sendTemplate(account, waContact, template, settings.templateLang, msg.params);
      body = msg.text;
    } else {
      throw new Error(
        `Pasaron más de 24 h desde el último mensaje de ${msg.template === 'owner' ? 'ese teléfono' : 'el cliente'}: WhatsApp solo deja escribir con una plantilla aprobada. Cargala en Configuración → Cobranza.`,
      );
    }
    const ctx = RequestContextStore.get();
    await this.uow.run(async (tx) => {
      const now = new Date();
      const c =
        conv ??
        (await tx.conversation.create({
          data: { tenantId: ctx.tenantId, accountId: account.id, waContactId: waContact, customerId, status: 'CLOSED', lastMessageAt: now },
        }));
      await tx.message.create({
        data: { tenantId: ctx.tenantId, conversationId: c.id, waMessageId: waId, direction: 'OUTBOUND', type: open ? 'text' : 'template', body, status: 'SENT', sentBy: SENDER, sentAt: now },
      });
      await tx.conversation.update({ where: { id: c.id }, data: { lastMessageAt: now } });
    });
  }

  private async record(chargeId: string, kind: string, status: string, toPhone: string | null, error: string | null, append = false) {
    const ctx = RequestContextStore.get();
    await this.uow.run(async (tx) => {
      const data = { status, toPhone, error: error?.slice(0, 500) ?? null, createdAt: new Date() };
      if (append) await tx.collectionNotice.deleteMany({ where: { chargeId, kind } });
      await tx.collectionNotice.upsert({
        where: { chargeId_kind: { chargeId, kind } },
        create: { tenantId: ctx.tenantId, chargeId, kind, ...data },
        update: data,
      });
    });
  }
}

function ownerMessage(item: OpenItem, today: Date, kind: string) {
  const days = daysBetween(today, item.dueDate);
  const when = kind === 'OWNER_BEFORE' ? `vence el ${shortDay(item.dueDate)} (en ${days} ${days === 1 ? 'día' : 'días'})` : days === 0 ? 'vence hoy' : `venció el ${shortDay(item.dueDate)}`;
  const tail = kind === 'OWNER_DUE' ? (item.phone ? ' Le mandamos el recordatorio al cliente.' : ' El cliente no tiene teléfono cargado.') : '';
  return {
    text: `Cobranza: ${item.customer} debe ${money(item.balance)} del ${item.label}, que ${when}.${tail}`,
    template: 'owner' as const,
    // Plantilla: "el cliente {{1}} tiene un saldo de ${{2}} por {{3}} que vence el {{4}}"
    params: [item.customer, plain(item.balance), item.label, shortDay(item.dueDate)],
  };
}

function customerMessage(item: OpenItem, today: Date) {
  const days = daysBetween(today, item.dueDate);
  const when = days > 0 ? `vence el ${shortDay(item.dueDate)}` : days === 0 ? 'vence hoy' : `venció el ${shortDay(item.dueDate)}`;
  return {
    text: `Hola ${item.customer}, te recordamos que el saldo de ${money(item.balance)} del ${item.label} ${when}. Si ya lo pagaste, avisanos así lo registramos. ¡Gracias!`,
    template: 'customer' as const,
    // Plantilla: "Hola {{1}}, te recordamos que tenés un saldo pendiente de ${{2}} por {{3}}, con vencimiento el {{4}}."
    params: [item.customer, plain(item.balance), item.label, shortDay(item.dueDate)],
  };
}

function ctxFor(tenantId: string) {
  return {
    tenantId,
    userId: '00000000-0000-0000-0000-000000000000',
    actor: SENDER,
    actorType: 'INTEGRATION' as const,
    roleKey: 'system',
    permissions: new Set(ALL_PERMISSIONS),
    branchScope: [],
    maxDiscount: 0,
    correlationId: randomUUID(),
  };
}
