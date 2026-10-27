import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryController } from './inventory.controller';
import { InventoryFacade } from './inventory.facade';
import { InventoryService } from './inventory.service';
import { InventoryAiTools } from './inventory.tools';

@Module({
  imports: [CatalogModule],
  controllers: [InventoryController],
  providers: [InventoryFacade, InventoryService, InventoryAiTools],
  exports: [InventoryFacade, InventoryService],
})
export class InventoryModule {}
