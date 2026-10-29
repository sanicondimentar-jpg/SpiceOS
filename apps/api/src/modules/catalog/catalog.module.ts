import { Module } from '@nestjs/common';
import { CatalogFacade } from './catalog.facade';
import { CatalogAiTools } from './catalog.tools';
import { CatalogController } from './catalog.controller';
import { PublicCatalogController } from './public-catalog.controller';
import { CertificationsService } from './application/certifications.service';
import { PriceListsService } from './application/price-lists.service';
import { ProductsService } from './application/products.service';
import { PublicCatalogService } from './application/public-catalog.service';

@Module({
  controllers: [CatalogController, PublicCatalogController],
  providers: [CatalogFacade, CatalogAiTools, ProductsService, PriceListsService, CertificationsService, PublicCatalogService],
  exports: [CatalogFacade, ProductsService, PriceListsService],
})
export class CatalogModule {}
