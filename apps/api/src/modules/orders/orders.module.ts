import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CrmModule } from '../crm/crm.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PublicOrdersController } from './public-orders.controller';
import { WebOrdersService } from './web-orders.service';
import { WhatsappWebOrdersConsumer } from './whatsapp-web-orders.consumer';

@Module({
  imports: [CrmModule, CatalogModule, InventoryModule, PurchasingModule],
  controllers: [OrdersController, PublicOrdersController],
  providers: [OrdersService, WebOrdersService, WhatsappWebOrdersConsumer],
})
export class OrdersModule {}
