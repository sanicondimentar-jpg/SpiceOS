import { Module } from '@nestjs/common';
import { CatalogFacade } from './catalog.facade';
import { CatalogAiTools } from './catalog.tools';
import { CatalogController } from './catalog.controller';
import { CertificationsService } from './application/certifications.service';
import { PriceListsService } from './application/price-lists.service';
import { ProductsService } from './application/products.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogFacade, CatalogAiTools, ProductsService, PriceListsService, CertificationsService],
  exports: [CatalogFacade, ProductsService, PriceListsService],
})
export class CatalogModule {}
