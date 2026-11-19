import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createRouteSchema,
  failedStopSchema,
  updateRouteSchema,
  type CreateRouteInput,
  type FailedStopInput,
  type UpdateRouteInput,
} from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { LogisticsService } from './logistics.service';

@ApiTags('Logística')
@ApiBearerAuth()
@Controller('logistics')
export class LogisticsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get('pending')
  @RequirePermissions(PERMISSIONS.orders.read)
  pending() {
    return this.logistics.pending();
  }

  @Get('routes')
  @RequirePermissions(PERMISSIONS.orders.read)
  routes() {
    return this.logistics.listRoutes();
  }

  @Post('routes')
  @RequirePermissions(PERMISSIONS.orders.write)
  create(@Body(new ZodPipe(createRouteSchema)) body: CreateRouteInput) {
    return this.logistics.createRoute(body);
  }

  @Get('routes/:id')
  @RequirePermissions(PERMISSIONS.orders.read)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.logistics.getRoute(id);
  }

  @Patch('routes/:id')
  @RequirePermissions(PERMISSIONS.orders.write)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateRouteSchema)) body: UpdateRouteInput) {
    return this.logistics.updateRoute(id, body);
  }

  @Delete('routes/:id')
  @RequirePermissions(PERMISSIONS.orders.write)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.logistics.deleteRoute(id);
  }

  @Post('routes/:id/start')
  @RequirePermissions(PERMISSIONS.orders.write)
  start(@Param('id', ParseUUIDPipe) id: string) {
    return this.logistics.start(id);
  }

  @Post('stops/:deliveryId/delivered')
  @RequirePermissions(PERMISSIONS.orders.write)
  delivered(@Param('deliveryId', ParseUUIDPipe) id: string) {
    return this.logistics.delivered(id);
  }

  @Post('stops/:deliveryId/failed')
  @RequirePermissions(PERMISSIONS.orders.write)
  failed(@Param('deliveryId', ParseUUIDPipe) id: string, @Body(new ZodPipe(failedStopSchema)) body: FailedStopInput) {
    return this.logistics.failed(id, body);
  }
}
