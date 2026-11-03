import { Controller, ForbiddenException, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../shared/auth/decorators';
import { env } from '../../shared/config/env';
import { EncryptionService } from '../../shared/crypto/encryption.service';
import { SystemPrismaService } from '../../shared/prisma/prisma.service';
import { InboundMessageService, WebhookPayload } from './inbound-message.service';

/**
 * Webhook de Meta. Autenticado por firma HMAC (X-Hub-Signature-256), no por JWT.
 * El token de verificación y el secreto de la app salen de la cuenta cargada en Configuración
 * (o de las variables de entorno, si están).
 */
@ApiExcludeController()
@Controller('integrations/whatsapp/webhook')
export class WhatsappWebhookController {
  constructor(
    private readonly inbound: InboundMessageService,
    private readonly system: SystemPrismaService,
    private readonly crypto: EncryptionService,
  ) {}

  @Public()
  @Get()
  async verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string) {
    if (mode !== 'subscribe' || !token) throw new ForbiddenException();
    if (token === env().WHATSAPP_VERIFY_TOKEN) return challenge;
    if (await this.system.whatsappAccount.findUnique({ where: { verifyToken: token }, select: { id: true } })) return challenge;
    throw new ForbiddenException();
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>) {
    await this.assertSignature(req);
    // Respondemos rápido: el procesamiento pesado (audio, IA) va por eventos al worker.
    await this.inbound.handle(req.body as WebhookPayload);
    return { ok: true };
  }

  private async assertSignature(req: RawBodyRequest<Request>) {
    const signature = req.headers['x-hub-signature-256'];
    if (typeof signature !== 'string' || !req.rawBody) throw new ForbiddenException();
    for (const secret of await this.secrets()) {
      const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`);
      const got = Buffer.from(signature);
      if (got.length === expected.length && timingSafeEqual(got, expected)) return;
    }
    throw new ForbiddenException('Firma inválida');
  }

  private async secrets(): Promise<string[]> {
    const accounts = await this.system.whatsappAccount.findMany({
      where: { encryptedAppSecret: { not: null } },
      select: { encryptedAppSecret: true },
    });
    const fromDb = accounts.map((a) => this.crypto.decrypt(a.encryptedAppSecret!));
    const fromEnv = env().WHATSAPP_APP_SECRET;
    return fromEnv ? [fromEnv, ...fromDb] : fromDb;
  }
}
