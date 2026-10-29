import { Body, Controller, Header, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { webOrderSchema, type WebOrderInput } from '@spiceos/contracts';
import { Public } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { WebOrdersService } from './web-orders.service';

/** Pedidos de la web pública (saboracasa.com.ar): sin login; quedan pendientes de revisión. */
@ApiTags('Pedidos web')
@Controller('public/orders')
export class PublicOrdersController {
  constructor(private readonly webOrders: WebOrdersService) {}

  @Public()
  @Post(':org')
  @HttpCode(201)
  // Hasta 20 pedidos por hora desde una misma IP: frena robots sin molestar a un cliente real.
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Header('Cross-Origin-Resource-Policy', 'cross-origin')
  create(@Param('org') org: string, @Body(new ZodPipe(webOrderSchema)) body: WebOrderInput) {
    return this.webOrders.receive(org, body);
  }
}
