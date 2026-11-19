import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ApiKeysService } from './api-keys.service';
import { PendingReceiptsService } from './pending-receipts.service';
import { ReceiptReaderService } from './receipt-reader.service';
import { ApiKeysController, ReceiptsController } from './receipts.controller';
import { WhatsappReceiptsConsumer } from './whatsapp-receipts.consumer';

/** Remitos de compra: lectura con IA (foto/PDF), por WhatsApp de proveedores autorizados y con clave de acceso. */
@Module({
  imports: [InventoryModule, MessagingModule],
  controllers: [ReceiptsController, ApiKeysController],
  providers: [ReceiptReaderService, PendingReceiptsService, ApiKeysService, WhatsappReceiptsConsumer],
})
export class ReceiptsModule {}
