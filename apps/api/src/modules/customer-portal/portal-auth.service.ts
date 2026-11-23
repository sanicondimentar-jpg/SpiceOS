import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PortalLoginStart, PortalLoginStatus } from '@spiceos/contracts';
import { NotFoundError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import { SystemPrismaService } from '../../shared/prisma/prisma.service';
import { RequestContextStore, type RequestContext } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { phoneVariants } from '../crm/domain/customer';
import { WhatsappClient } from '../messaging/whatsapp.client';
import { BUSINESS_WHATSAPP, LOGIN_CODE_TTL_MS, SESSION_TTL_MS, loginCodeIn, loginMessage, newLoginCode } from './portal-code';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Quién usa el portal: el cliente de la sesión, dentro de su empresa. */
export interface PortalCustomer {
  id: string;
  name: string;
  phone: string;
  priceListId: string | null;
}

/** Remitente de las respuestas automáticas del portal en la bandeja de WhatsApp. */
const PORTAL_SENDER = 'system:portal';

/** Cada cuánto se renueva la sesión al usarla (no hace falta escribir en cada pedido). */
const TOUCH_EVERY_MS = 3600_000;

/**
 * Ingreso al portal de clientes sin contraseña: el portal muestra un código, el cliente lo manda
 * por WhatsApp y el número desde el que escribe dice quién es (tiene que ser el de su ficha o el
 * de un contacto). La clave que guardó el navegador al pedir el código pasa a ser la sesión.
 */
@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);

  constructor(
    private readonly system: SystemPrismaService,
    private readonly uow: UnitOfWork,
    private readonly whatsapp: WhatsappClient,
  ) {}

  /** Contexto de la empresa para un pedido del portal (sin usuario: actúa la integración). */
  async context(orgAlias: string, actor = 'integration:portal'): Promise<RequestContext> {
    const company = await this.system.company.findUnique({ where: { keycloakOrgId: orgAlias }, select: { id: true, status: true } });
    if (!company || company.status !== 'ACTIVE') throw new NotFoundError('Empresa', orgAlias);
    return {
      tenantId: company.id,
      userId: '00000000-0000-0000-0000-000000000000',
      actor,
      actorType: 'INTEGRATION',
      roleKey: 'system',
      permissions: new Set(),
      branchScope: [],
      maxDiscount: 0,
      correlationId: randomUUID(),
    };
  }

  async start(orgAlias: string): Promise<PortalLoginStart> {
    const ctx = await this.context(orgAlias);
    return RequestContextStore.run(ctx, () =>
      this.uow.run(async (tx) => {
        const now = new Date();
        // Códigos vencidos de hace más de un día: no sirven para nada.
        await tx.portalLoginRequest.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } });
        let code = newLoginCode();
        for (let i = 0; i < 5 && (await tx.portalLoginRequest.count({ where: { code, status: 'PENDING', expiresAt: { gt: now } } })); i++) {
          code = newLoginCode();
        }
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(now.getTime() + LOGIN_CODE_TTL_MS);
        const r = await tx.portalLoginRequest.create({ data: { tenantId: ctx.tenantId, code, tokenHash: hash(token), expiresAt } });
        const message = loginMessage(code);
        return {
          requestId: r.id,
          token,
          code,
          message,
          whatsappUrl: `https://wa.me/${BUSINESS_WHATSAPP}?text=${encodeURIComponent(message)}`,
          expiresAt: expiresAt.toISOString(),
        };
      }),
    );
  }

  /** El portal pregunta cada unos segundos si ya llegó el código por WhatsApp. */
  async status(orgAlias: string, requestId: string, token: string | undefined): Promise<PortalLoginStatus> {
    if (!token) throw new UnauthorizedException('Falta la clave del portal');
    const ctx = await this.context(orgAlias);
    return RequestContextStore.run(ctx, () =>
      this.uow.read(async (tx) => {
        const r = await tx.portalLoginRequest.findFirst({ where: { id: requestId, tokenHash: hash(token) } });
        if (!r) throw new NotFoundError('Ingreso', requestId);
        if (r.status === 'OK') {
          const c = r.customerId ? await tx.customer.findFirst({ where: { id: r.customerId }, select: { legalName: true, tradeName: true } }) : null;
          return { status: 'ok', customerName: c ? (c.tradeName ?? c.legalName) : undefined };
        }
        if (r.status === 'NOT_CUSTOMER') return { status: 'not_customer' };
        return { status: r.expiresAt < new Date() ? 'expired' : 'pending' };
      }),
    );
  }

  /**
   * Worker: llegó un mensaje de WhatsApp. Si trae un código del portal, abre la sesión del cliente
   * de ese número y le contesta en el chat. Devuelve true si el mensaje era para el portal.
   */
  async verifyFromWhatsapp(conversationId: string, text: string | null): Promise<boolean> {
    const code = loginCodeIn(text);
    if (!code) return false;
    const conv = await this.uow.read((tx) => tx.conversation.findFirst({ where: { id: conversationId }, include: { account: true } }));
    if (!conv) return false;
    const phone = conv.waContactId;

    const outcome = await this.uow.run(async (tx, scope) => {
      const now = new Date();
      const request = await tx.portalLoginRequest.findFirst({ where: { code, status: 'PENDING', expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
      if (!request) return { kind: 'expired' as const };
      const customer = await this.customerByPhone(tx, phone);
      if (!customer) {
        await tx.portalLoginRequest.update({ where: { id: request.id }, data: { status: 'NOT_CUSTOMER', phone, verifiedAt: now } });
        return { kind: 'not_customer' as const };
      }
      await tx.portalSession.create({
        data: {
          tenantId: request.tenantId,
          customerId: customer.id,
          tokenHash: request.tokenHash,
          phone,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        },
      });
      await tx.portalLoginRequest.update({ where: { id: request.id }, data: { status: 'OK', phone, customerId: customer.id, verifiedAt: now } });
      if (!conv.customerId) await tx.conversation.update({ where: { id: conv.id }, data: { customerId: customer.id } });
      scope.auditLog({ action: 'portal.login', entityType: 'customer', entityId: customer.id, after: { phone } });
      return { kind: 'ok' as const, name: customer.name };
    });

    const reply = {
      ok: `¡Listo${outcome.kind === 'ok' ? `, ${outcome.name}` : ''}! Ya entraste al portal de clientes de Sabor a Casa. Volvé a la página para ver tus precios y hacer tu pedido.`,
      not_customer:
        'Tu número todavía no figura como cliente de Sabor a Casa, así que no pudimos abrirte el portal. Escribinos por acá el nombre de tu comercio y la dirección, y te damos de alta.',
      expired: 'Ese código ya venció o ya se usó. Volvé al portal y tocá de nuevo "Entrar con WhatsApp" para pedir uno nuevo.',
    }[outcome.kind];
    await this.reply(conv, reply).catch((e: Error) => this.logger.warn(`Portal: no se pudo contestar el código por WhatsApp: ${e.message}`));
    return true;
  }

  /** Cliente de la sesión del portal, o 401 si la clave no sirve (venció, se cerró o el cliente se dio de baja). */
  async resolve(tx: Tx, token: string | undefined): Promise<PortalCustomer> {
    if (!token) throw new UnauthorizedException('Entrá al portal con tu WhatsApp');
    const now = new Date();
    const s = await tx.portalSession.findFirst({
      where: { tokenHash: hash(token), revokedAt: null, expiresAt: { gt: now } },
      include: { customer: { select: { id: true, legalName: true, tradeName: true, priceListId: true, status: true, deletedAt: true } } },
    });
    if (!s || s.customer.deletedAt || !['ACTIVE', 'PROSPECT'].includes(s.customer.status)) {
      throw new UnauthorizedException('Tu sesión del portal venció: entrá de nuevo con tu WhatsApp');
    }
    if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await tx.portalSession.update({ where: { id: s.id }, data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) } });
    }
    return { id: s.customer.id, name: s.customer.tradeName ?? s.customer.legalName, phone: s.phone, priceListId: s.customer.priceListId };
  }

  async logout(orgAlias: string, token: string | undefined) {
    if (!token) return { ok: true };
    const ctx = await this.context(orgAlias);
    await RequestContextStore.run(ctx, () =>
      this.uow.run((tx) => tx.portalSession.updateMany({ where: { tokenHash: hash(token), revokedAt: null }, data: { revokedAt: new Date() } })),
    );
    return { ok: true };
  }

  private async customerByPhone(tx: Tx, phone: string) {
    const phones = phoneVariants(phone);
    if (!phones.length) return null;
    const c = await tx.customer.findFirst({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'PROSPECT'] },
        OR: [{ phone: { in: phones } }, { contacts: { some: { phone: { in: phones }, deletedAt: null } } }],
      },
      // Si el número está en más de una ficha, gana la del cliente activo más reciente.
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }], // enum: ACTIVE va antes que PROSPECT en orden descendente
      select: { id: true, legalName: true, tradeName: true },
    });
    return c ? { id: c.id, name: c.tradeName ?? c.legalName } : null;
  }

  /** El cliente acaba de escribir: la ventana de 24 h de WhatsApp está abierta. */
  private async reply(conv: { id: string; tenantId: string; waContactId: string; account: Parameters<WhatsappClient['sendText']>[0] }, body: string) {
    const waId = await this.whatsapp.sendText(conv.account, conv.waContactId, body);
    const now = new Date();
    await this.uow.run(async (tx) => {
      await tx.message.create({
        data: { tenantId: conv.tenantId, conversationId: conv.id, waMessageId: waId, direction: 'OUTBOUND', type: 'text', body, status: 'SENT', sentBy: PORTAL_SENDER, sentAt: now },
      });
      await tx.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: now, unreadCount: 0 } });
    });
  }
}
