import { Module } from '@nestjs/common';
import { CatalogFacade } from './catalog.facade';
import { CatalogAiTools } from './catalog.tools';

@Module({
  providers: [CatalogFacade, CatalogAiTools],
  exports: [CatalogFacade],
})
export class CatalogModule {}
