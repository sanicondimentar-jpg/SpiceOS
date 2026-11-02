import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { ConversationsService } from './conversations.service';
import { InboundMessageService } from './inbound-message.service';
import { ConversationsController, WhatsappAccountController } from './messaging.controller';
import { MessageEnrichmentConsumer } from './message-enrichment.consumer';
import { MessagingAiTools } from './messaging.tools';
import { WhatsappAccountService } from './whatsapp-account.service';
import { WhatsappClient } from './whatsapp.client';
import { WhatsappWebhookController } from './whatsapp.webhook.controller';

@Module({
  imports: [CrmModule],
  controllers: [WhatsappWebhookController, ConversationsController, WhatsappAccountController],
  providers: [WhatsappClient, InboundMessageService, ConversationsService, WhatsappAccountService, MessageEnrichmentConsumer, MessagingAiTools],
})
export class MessagingModule {}
