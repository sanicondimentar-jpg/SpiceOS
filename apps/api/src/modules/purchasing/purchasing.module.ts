import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseOrdersController, SuppliersController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [InventoryModule],
  controllers: [PurchaseOrdersController, SuppliersController],
  providers: [PurchasingService, SuppliersService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
