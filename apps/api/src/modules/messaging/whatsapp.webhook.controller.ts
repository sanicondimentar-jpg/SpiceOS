import { Controller, ForbiddenException, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../shared/auth/decorators';
import { env } from '../../shared/config/env';
import { InboundMessageService, WebhookPayload } from './inbound-message.service';

/** Webhook de Meta. Autenticado por firma HMAC (X-Hub-Signature-256), no por JWT. */
@ApiExcludeController()
@Controller('integrations/whatsapp/webhook')
export class WhatsappWebhookController {
  constructor(private readonly inbound: InboundMessageService) {}

  @Public()
  @Get()
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string) {
    if (mode === 'subscribe' && token === env().WHATSAPP_VERIFY_TOKEN) return challenge;
    throw new ForbiddenException();
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>) {
    this.assertSignature(req);
    // Respondemos rápido: el procesamiento pesado (audio, IA) va por eventos al worker.
    await this.inbound.handle(req.body as WebhookPayload);
    return { ok: true };
  }

  private assertSignature(req: RawBodyRequest<Request>) {
    const secret = env().WHATSAPP_APP_SECRET;
    const signature = req.headers['x-hub-signature-256'];
    if (!secret || typeof signature !== 'string' || !req.rawBody) throw new ForbiddenException();
    const expected = `sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Firma inválida');
  }
}
