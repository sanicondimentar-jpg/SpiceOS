import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  adjustStockSchema,
  breakPackSchema,
  movementsQuerySchema,
  receiveStockSchema,
  stockQuerySchema,
  type AdjustStockInput,
  type BreakPackInput,
  type MovementsQuery,
  type ReceiveStockInput,
  type StockQuery,
} from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { InventoryService } from './inventory.service';

@ApiTags('Inventario')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('warehouses')
  @RequirePermissions(PERMISSIONS.inventory.read)
  warehouses() {
    return this.inventory.warehouses();
  }

  @Get('stock')
  @RequirePermissions(PERMISSIONS.inventory.read)
  stock(@Query(new ZodPipe(stockQuerySchema)) query: StockQuery) {
    return this.inventory.stock(query);
  }

  @Get('stock/:variantId')
  @RequirePermissions(PERMISSIONS.inventory.read)
  variantStock(@Param('variantId', ParseUUIDPipe) variantId: string) {
    return this.inventory.variantStock(variantId);
  }

  @Get('movements')
  @RequirePermissions(PERMISSIONS.inventory.read)
  movements(@Query(new ZodPipe(movementsQuerySchema)) query: MovementsQuery) {
    return this.inventory.movements(query);
  }

  @Post('receipts')
  @RequirePermissions(PERMISSIONS.inventory.adjust)
  receive(@Body(new ZodPipe(receiveStockSchema)) body: ReceiveStockInput) {
    return this.inventory.receive(body);
  }

  @Post('adjustments')
  @RequirePermissions(PERMISSIONS.inventory.adjust)
  adjust(@Body(new ZodPipe(adjustStockSchema)) body: AdjustStockInput) {
    return this.inventory.adjust(body);
  }

  @Post('break-pack')
  @RequirePermissions(PERMISSIONS.inventory.adjust)
  breakPack(@Body(new ZodPipe(breakPackSchema)) body: BreakPackInput) {
    return this.inventory.breakPack(body);
  }
}
