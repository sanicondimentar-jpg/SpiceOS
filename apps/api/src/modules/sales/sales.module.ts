import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CrmModule } from '../crm/crm.module';
import { QuotesService } from './quotes.service';
import { SalesController } from './sales.controller';
import { SalesAiTools } from './sales.tools';

@Module({
  imports: [CatalogModule, CrmModule],
  controllers: [SalesController],
  providers: [QuotesService, SalesAiTools],
  exports: [QuotesService],
})
export class SalesModule {}
