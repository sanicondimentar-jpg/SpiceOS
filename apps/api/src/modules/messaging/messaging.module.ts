import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { InboundMessageService } from './inbound-message.service';
import { MessageEnrichmentConsumer } from './message-enrichment.consumer';
import { MessagingAiTools } from './messaging.tools';
import { WhatsappClient } from './whatsapp.client';
import { WhatsappWebhookController } from './whatsapp.webhook.controller';

@Module({
  imports: [CrmModule],
  controllers: [WhatsappWebhookController],
  providers: [WhatsappClient, InboundMessageService, MessageEnrichmentConsumer, MessagingAiTools],
})
export class MessagingModule {}
