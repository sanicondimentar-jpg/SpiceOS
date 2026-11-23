import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res, Header } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  PORTAL_TOKEN_HEADER,
  portalLoginStatusSchema,
  portalOrderSchema,
  type PortalLoginStatusInput,
  type PortalOrderInput,
} from '@spiceos/contracts';
import { Public } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { PortalAuthService } from './portal-auth.service';
import { PortalService } from './portal.service';

/**
 * Portal de clientes mayoristas (lo usa www.saboracasa.com.ar/mayoristas desde otro dominio).
 * No usa el login de SpiceOS: la sesión del cliente viaja en el encabezado x-portal-token.
 */
@ApiTags('Portal de clientes')
@Controller('public/portal')
export class PortalController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly portal: PortalService,
  ) {}

  /** Pide un código para entrar: el cliente lo manda por WhatsApp desde su teléfono. */
  @Public()
  @Post(':org/login')
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'no-store')
  login(@Param('org') org: string) {
    return this.auth.start(org);
  }

  /** ¿Ya llegó el código por WhatsApp? El portal pregunta cada unos segundos. */
  @Public()
  @Post(':org/login/status')
  @HttpCode(200)
  @Throttle({ default: { limit: 600, ttl: 3_600_000 } })
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'no-store')
  loginStatus(
    @Param('org') org: string,
    @Headers(PORTAL_TOKEN_HEADER) token: string | undefined,
    @Body(new ZodPipe(portalLoginStatusSchema)) body: PortalLoginStatusInput,
  ) {
    return this.auth.status(org, body.requestId, token);
  }

  @Public()
  @Post(':org/logout')
  @HttpCode(200)
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  logout(@Param('org') org: string, @Headers(PORTAL_TOKEN_HEADER) token: string | undefined) {
    return this.auth.logout(org, token);
  }

  @Public()
  @Get(':org/me')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'no-store')
  me(@Param('org') org: string, @Headers(PORTAL_TOKEN_HEADER) token: string | undefined) {
    return this.portal.me(org, token);
  }

  @Public()
  @Get(':org/prices')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'no-store')
  prices(@Param('org') org: string, @Headers(PORTAL_TOKEN_HEADER) token: string | undefined) {
    return this.portal.prices(org, token);
  }

  @Public()
  @Get(':org/orders')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'no-store')
  orders(@Param('org') org: string, @Headers(PORTAL_TOKEN_HEADER) token: string | undefined) {
    return this.portal.orders(org, token);
  }

  @Public()
  @Post(':org/orders')
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 3_600_000 } })
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'no-store')
  createOrder(
    @Param('org') org: string,
    @Headers(PORTAL_TOKEN_HEADER) token: string | undefined,
    @Body(new ZodPipe(portalOrderSchema)) body: PortalOrderInput,
  ) {
    return this.portal.createOrder(org, token, body);
  }

  @Public()
  @Get(':org/account')
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  @Header('Cache-Control', 'no-store')
  account(@Param('org') org: string, @Headers(PORTAL_TOKEN_HEADER) token: string | undefined) {
    return this.portal.account(org, token);
  }

  @Public()
  @Get(':org/invoices/:id/pdf')
  async invoicePdf(
    @Param('org') org: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(PORTAL_TOKEN_HEADER) token: string | undefined,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.portal.invoicePdf(org, token, id);
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Access-Control-Expose-Headers': 'Content-Disposition',
      })
      .send(buffer);
  }
}
