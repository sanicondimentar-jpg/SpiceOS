import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { WhatsappAccountInput } from '@spiceos/contracts';
import { UnitOfWork } from '../../shared/unit-of-work';
import { BusinessRuleError, ConflictError } from '../../shared/domain/errors';
import { EncryptionService } from '../../shared/crypto/encryption.service';
import { SystemPrismaService } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { WhatsappClient } from './whatsapp.client';

/**
 * Cuenta de WhatsApp Cloud API de la empresa, cargada desde Configuración.
 * El token y el secreto de la app se guardan cifrados y nunca se devuelven.
 */
@Injectable()
export class WhatsappAccountService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly system: SystemPrismaService,
    private readonly crypto: EncryptionService,
    private readonly whatsapp: WhatsappClient,
  ) {}

  get(webhookUrl: string) {
    return this.uow.read(async (tx) => {
      const a = await tx.whatsappAccount.findFirst();
      return {
        webhookUrl,
        account: a && {
          phoneNumberId: a.phoneNumberId,
          wabaId: a.wabaId,
          displayPhone: a.displayPhone,
          verifiedName: a.verifiedName,
          autoCreateCustomer: a.autoCreateCustomer,
          hasAppSecret: !!a.encryptedAppSecret,
          verifyToken: a.verifyToken,
          connectedAt: a.connectedAt,
        },
      };
    });
  }

  /**
   * Guarda la cuenta: prueba el número y el token contra Meta, suscribe la app a la cuenta de WhatsApp
   * y genera el token de verificación que se pega en Meta al configurar el webhook.
   */
  async save(input: WhatsappAccountInput, webhookUrl: string) {
    const ctx = RequestContextStore.get();
    const existing = await this.uow.read((tx) => tx.whatsappAccount.findFirst());
    const token = input.accessToken || (existing && this.crypto.decrypt(existing.encryptedToken));
    if (!token) throw new BusinessRuleError('Falta el token de acceso');
    const appSecret = input.appSecret || (existing?.encryptedAppSecret && this.crypto.decrypt(existing.encryptedAppSecret));
    if (!appSecret) throw new BusinessRuleError('Falta la clave secreta de la app (App secret)');

    const other = await this.system.whatsappAccount.findUnique({ where: { phoneNumberId: input.phoneNumberId }, select: { tenantId: true } });
    if (other && other.tenantId !== ctx.tenantId) throw new ConflictError('Ese número ya está conectado a otra empresa');

    let info: { displayPhone: string; verifiedName: string | null };
    try {
      info = await this.whatsapp.phoneInfo(input.phoneNumberId, token);
    } catch (e) {
      throw new BusinessRuleError(`Meta no aceptó el identificador del número o el token: ${(e as Error).message}`);
    }
    let subscribeError: string | null = null;
    try {
      await this.whatsapp.subscribeApp(input.wabaId, token);
    } catch (e) {
      subscribeError = (e as Error).message;
    }

    const data = {
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      displayPhone: info.displayPhone,
      verifiedName: info.verifiedName,
      encryptedToken: this.crypto.encrypt(token),
      encryptedAppSecret: this.crypto.encrypt(appSecret),
      autoCreateCustomer: input.autoCreateCustomer,
      connectedAt: subscribeError ? existing?.connectedAt ?? null : new Date(),
    };
    await this.uow.run(async (tx, scope) => {
      if (existing) await tx.whatsappAccount.update({ where: { id: existing.id }, data });
      else await tx.whatsappAccount.create({ data: { ...data, tenantId: ctx.tenantId, verifyToken: randomBytes(16).toString('hex') } });
      scope.auditLog({
        action: existing ? 'whatsapp_account.update' : 'whatsapp_account.create',
        entityType: 'whatsapp_account',
        entityId: input.phoneNumberId,
        after: { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, displayPhone: info.displayPhone },
      });
    });
    return { ...(await this.get(webhookUrl)), subscribeError };
  }
}
