import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  categorySchema,
  certificationSchema,
  createProductSchema,
  priceItemsSchema,
  priceListSchema,
  productCertificationSchema,
  productListQuerySchema,
  repriceSchema,
  updateCostSchema,
  updateProductSchema,
  updateVariantSchema,
  variantSchema,
  type CategoryInput,
  type CertificationInput,
  type CreateProductInput,
  type PriceItemsInput,
  type PriceListInput,
  type ProductCertificationInput,
  type ProductListQuery,
  type RepriceInput,
  type UpdateCostInput,
  type UpdateProductInput,
  type UpdateVariantInput,
  type VariantInput,
} from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { CertificationsService } from './application/certifications.service';
import { PriceListsService } from './application/price-lists.service';
import { ProductsService } from './application/products.service';

@ApiTags('Catálogo')
@ApiBearerAuth()
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly priceLists: PriceListsService,
    private readonly certifications: CertificationsService,
  ) {}

  // ---------- Productos y presentaciones ----------
  @Get('products')
  @RequirePermissions(PERMISSIONS.catalog.read)
  listProducts(@Query(new ZodPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.products.list(query);
  }

  @Get('products/:id')
  @RequirePermissions(PERMISSIONS.catalog.read)
  getProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.get(id);
  }

  @Post('products')
  @RequirePermissions(PERMISSIONS.catalog.write)
  createProduct(@Body(new ZodPipe(createProductSchema)) body: CreateProductInput) {
    return this.products.create(body);
  }

  @Patch('products/:id')
  @RequirePermissions(PERMISSIONS.catalog.write)
  updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateProductSchema)) body: UpdateProductInput) {
    return this.products.update(id, body);
  }

  @Post('products/:id/variants')
  @RequirePermissions(PERMISSIONS.catalog.write)
  addVariant(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(variantSchema)) body: VariantInput) {
    return this.products.addVariant(id, body);
  }

  @Patch('variants/:id')
  @RequirePermissions(PERMISSIONS.catalog.write)
  updateVariant(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateVariantSchema)) body: UpdateVariantInput) {
    return this.products.updateVariant(id, body);
  }

  @Put('variants/:id/cost')
  @RequirePermissions(PERMISSIONS.catalog.write, PERMISSIONS.catalog.costRead)
  updateCost(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateCostSchema)) body: UpdateCostInput) {
    return this.products.updateCost(id, body);
  }

  @Get('variants/:id/cost-history')
  @RequirePermissions(PERMISSIONS.catalog.costRead)
  costHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.costHistory(id);
  }

  @Get('categories')
  @RequirePermissions(PERMISSIONS.catalog.read)
  listCategories() {
    return this.products.listCategories();
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.catalog.write)
  createCategory(@Body(new ZodPipe(categorySchema)) body: CategoryInput) {
    return this.products.createCategory(body);
  }

  // ---------- Listas de precios ----------
  @Get('price-lists')
  @RequirePermissions(PERMISSIONS.catalog.read)
  listPriceLists() {
    return this.priceLists.list();
  }

  @Post('price-lists')
  @RequirePermissions(PERMISSIONS.catalog.write)
  createPriceList(@Body(new ZodPipe(priceListSchema)) body: PriceListInput) {
    return this.priceLists.create(body);
  }

  @Get('price-lists/:id/items')
  @RequirePermissions(PERMISSIONS.catalog.read)
  priceListItems(@Param('id', ParseUUIDPipe) id: string) {
    return this.priceLists.items(id);
  }

  @Put('price-lists/:id/items')
  @RequirePermissions(PERMISSIONS.catalog.write)
  upsertPriceItems(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(priceItemsSchema)) body: PriceItemsInput) {
    return this.priceLists.upsertItems(id, body);
  }

  /** Vista previa (dryRun: true) o aplicación de "costo × factor". */
  @Post('price-lists/:id/reprice')
  @RequirePermissions(PERMISSIONS.catalog.write, PERMISSIONS.catalog.costRead)
  reprice(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(repriceSchema)) body: RepriceInput) {
    return this.priceLists.reprice(id, body);
  }

  // ---------- Certificaciones ----------
  @Get('certifications')
  @RequirePermissions(PERMISSIONS.catalog.read)
  listCertifications() {
    return this.certifications.list();
  }

  @Post('certifications')
  @RequirePermissions(PERMISSIONS.catalog.write)
  createCertification(@Body(new ZodPipe(certificationSchema)) body: CertificationInput) {
    return this.certifications.create(body);
  }

  @Get('certifications/expiring')
  @RequirePermissions(PERMISSIONS.catalog.read)
  expiringCertifications(@Query('days') days = '60') {
    return this.certifications.expiring(Math.min(Math.max(Number(days) || 60, 0), 3650));
  }

  @Put('products/:id/certifications')
  @RequirePermissions(PERMISSIONS.catalog.write)
  assignCertification(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(productCertificationSchema)) body: ProductCertificationInput) {
    return this.certifications.assign(id, body);
  }

  @Delete('products/:id/certifications/:certificationId')
  @RequirePermissions(PERMISSIONS.catalog.write)
  unassignCertification(@Param('id', ParseUUIDPipe) id: string, @Param('certificationId', ParseUUIDPipe) certificationId: string) {
    return this.certifications.unassign(id, certificationId);
  }
}
