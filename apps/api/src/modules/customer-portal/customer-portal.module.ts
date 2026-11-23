import { Module } from '@nestjs/common';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { MessagingModule } from '../messaging/messaging.module';
import { OrdersModule } from '../orders/orders.module';
import { ReceivablesModule } from '../receivables/receivables.module';
import { PortalAdminController } from './portal-admin.controller';
import { PortalAuthService } from './portal-auth.service';
import { PortalController } from './portal.controller';
import { PortalLoginConsumer } from './portal-login.consumer';
import { PortalService } from './portal.service';

/** Portal de clientes mayoristas: precios, pedidos, cuenta corriente y facturas, con ingreso por WhatsApp. */
@Module({
  imports: [OrdersModule, ReceivablesModule, InvoicingModule, MessagingModule],
  controllers: [PortalController, PortalAdminController],
  providers: [PortalAuthService, PortalService, PortalLoginConsumer],
})
export class CustomerPortalModule {}
