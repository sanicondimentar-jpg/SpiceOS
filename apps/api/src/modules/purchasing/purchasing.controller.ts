import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createSupplierSchema,
  purchaseOrderListQuerySchema,
  purchaseOrderTransitionSchema,
  supplierProductsSchema,
  updatePurchaseOrderSchema,
  updateSupplierSchema,
  type CreateSupplierInput,
  type PurchaseOrderListQuery,
  type PurchaseOrderTransitionInput,
  type SupplierProductsInput,
  type UpdatePurchaseOrderInput,
  type UpdateSupplierInput,
} from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { PurchasingService } from './purchasing.service';
import { SuppliersService } from './suppliers.service';

@ApiTags('Compras')
@ApiBearerAuth()
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.purchasing.read)
  list(@Query(new ZodPipe(purchaseOrderListQuerySchema)) query: PurchaseOrderListQuery) {
    return this.purchasing.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.purchasing.read)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.purchasing.get(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.purchasing.write)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updatePurchaseOrderSchema)) body: UpdatePurchaseOrderInput) {
    return this.purchasing.update(id, body);
  }

  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.purchasing.write)
  transition(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(purchaseOrderTransitionSchema)) body: PurchaseOrderTransitionInput) {
    return this.purchasing.transition(id, body);
  }
}

@ApiTags('Compras')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.purchasing.read)
  list() {
    return this.suppliers.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.purchasing.write)
  create(@Body(new ZodPipe(createSupplierSchema)) body: CreateSupplierInput) {
    return this.suppliers.create(body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.purchasing.write)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSupplierSchema)) body: UpdateSupplierInput) {
    return this.suppliers.update(id, body);
  }

  @Post(':id/products')
  @RequirePermissions(PERMISSIONS.purchasing.write)
  setProducts(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(supplierProductsSchema)) body: SupplierProductsInput) {
    return this.suppliers.setProducts(id, body);
  }
}
