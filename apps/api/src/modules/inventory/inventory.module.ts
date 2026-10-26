import { Module } from '@nestjs/common';
import { InventoryFacade } from './inventory.facade';
import { InventoryAiTools } from './inventory.tools';

@Module({
  providers: [InventoryFacade, InventoryAiTools],
  exports: [InventoryFacade],
})
export class InventoryModule {}
