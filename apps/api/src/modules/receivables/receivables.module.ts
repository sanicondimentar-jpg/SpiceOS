import { Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { CollectionRemindersService } from './collection-reminders.service';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { ReceivablesAiTools } from './receivables.tools';

/** Cobranza: cuenta corriente de clientes, cobros en efectivo o en cuenta y avisos de vencimiento. */
@Module({
  imports: [MessagingModule],
  controllers: [CollectionsController],
  providers: [ReceivablesAiTools, CollectionsService, CollectionRemindersService],
  exports: [CollectionsService],
})
export class ReceivablesModule {}
