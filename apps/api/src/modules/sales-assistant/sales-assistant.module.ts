import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ReceivablesModule } from '../receivables/receivables.module';
import { StaffAssistantModule } from '../staff-assistant/staff-assistant.module';
import { AssistantSettingsService } from './assistant-settings.service';
import { SalesAssistantController } from './sales-assistant.controller';
import { SalesAssistantConsumer } from './sales-assistant.consumer';
import { SalesAssistantService } from './sales-assistant.service';

/** Asistente de ventas por WhatsApp con IA: responde, guía la compra y deja el pedido por confirmar. */
@Module({
  imports: [CrmModule, InventoryModule, MessagingModule, ReceivablesModule, StaffAssistantModule],
  controllers: [SalesAssistantController],
  providers: [SalesAssistantService, SalesAssistantConsumer, AssistantSettingsService],
})
export class SalesAssistantModule {}
