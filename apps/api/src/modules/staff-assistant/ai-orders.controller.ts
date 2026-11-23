import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, aiInstructionSchema, aiOrderListQuerySchema, type AiInstructionInput, type AiOrderListQuery } from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { AiOrdersService } from './ai-orders.service';

@ApiTags('Órdenes a la IA')
@ApiBearerAuth()
@Controller('ai-orders')
export class AiOrdersController {
  constructor(private readonly orders: AiOrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ai.read)
  list(@Query(new ZodPipe(aiOrderListQuerySchema)) query: AiOrderListQuery) {
    return this.orders.list(query);
  }

  /** Indicaciones para el asistente de ventas: ?all=true incluye las cortadas y vencidas. */
  @Get('instructions')
  @RequirePermissions(PERMISSIONS.ai.read)
  instructions(@Query('all') all?: string) {
    return this.orders.instructions(all === 'true');
  }

  @Post('instructions')
  @RequirePermissions(PERMISSIONS.ai.give)
  addInstruction(@Body(new ZodPipe(aiInstructionSchema)) body: AiInstructionInput) {
    return this.orders.addInstruction(body, 'web');
  }

  @Post('instructions/:id/revoke')
  @RequirePermissions(PERMISSIONS.ai.give)
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.revokeInstruction(id);
  }
}
