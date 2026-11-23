import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { MessagingModule } from '../messaging/messaging.module';
import { OrdersModule } from '../orders/orders.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { ReceivablesModule } from '../receivables/receivables.module';
import { AiOrdersController } from './ai-orders.controller';
import { AiOrdersService } from './ai-orders.service';
import { StaffAssistantService } from './staff-assistant.service';
import { StaffTools } from './staff-tools';

/** Órdenes a la IA: el asistente interno que atiende por WhatsApp a dueños y equipo, y su registro. */
@Module({
  imports: [CatalogModule, InventoryModule, InvoicingModule, MessagingModule, OrdersModule, PurchasingModule, ReceivablesModule],
  controllers: [AiOrdersController],
  providers: [AiOrdersService, StaffAssistantService, StaffTools],
  exports: [StaffAssistantService],
})
export class StaffAssistantModule {}
