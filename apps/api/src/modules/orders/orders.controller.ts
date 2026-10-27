import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateOrderInput,
  PERMISSIONS,
  createOrderSchema,
  orderListQuerySchema,
  orderPreviewSchema,
  orderTransitionSchema,
  updateOrderSchema,
  type OrderListQuery,
  type OrderPreviewInput,
  type OrderTransitionInput,
  type UpdateOrderInput,
} from '@spiceos/contracts';
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
  list(@Query(new ZodPipe(orderListQuerySchema)) query: OrderListQuery) {
    return this.orders.list(query);
  }

  @Post('preview')
  @RequirePermissions(PERMISSIONS.orders.write)
  preview(@Body(new ZodPipe(orderPreviewSchema)) body: OrderPreviewInput) {
    return this.orders.preview(body);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.orders.write)
  create(@Body(new ZodPipe(createOrderSchema)) body: CreateOrderInput) {
    return this.orders.create(body);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.orders.read)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.orders.write)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateOrderSchema)) body: UpdateOrderInput) {
    return this.orders.update(id, body);
  }

  @Post(':id/confirm')
  @RequirePermissions(PERMISSIONS.orders.confirm)
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.confirm(id);
  }

  /** Preparación, despacho y entrega los mueve depósito; cancelar requiere poder confirmar. */
  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.orders.write)
  transition(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(orderTransitionSchema)) body: OrderTransitionInput) {
    return this.orders.transition(id, body);
  }
}
