import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateOrderInput, PERMISSIONS, createOrderSchema } from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { OrdersService } from './orders.service';

@ApiTags('Pedidos')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.orders.read)
  list(@Query('status') status?: string, @Query('customerId') customerId?: string) {
    return this.orders.list(status, customerId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.orders.write)
  create(@Body(new ZodPipe(createOrderSchema)) body: CreateOrderInput) {
    return this.orders.create(body);
  }

  @Post(':id/confirm')
  @RequirePermissions(PERMISSIONS.orders.confirm)
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.confirm(id);
  }
}
