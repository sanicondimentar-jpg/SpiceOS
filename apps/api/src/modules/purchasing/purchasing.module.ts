import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseOrdersController, SuppliersController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';
import { SupplierAccountsController } from './supplier-accounts.controller';
import { SupplierAccountsService } from './supplier-accounts.service';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [InventoryModule],
  controllers: [PurchaseOrdersController, SuppliersController, SupplierAccountsController],
  providers: [PurchasingService, SuppliersService, SupplierAccountsService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
