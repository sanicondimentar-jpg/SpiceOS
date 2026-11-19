import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  assistantSettingsSchema,
  conversationAssistantSchema,
  type AssistantSettingsInput,
  type ConversationAssistantInput,
} from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { AssistantSettingsService } from './assistant-settings.service';

@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('messaging')
export class SalesAssistantController {
  constructor(private readonly settings: AssistantSettingsService) {}

  @Get('assistant')
  @RequirePermissions(PERMISSIONS.admin.settings)
  get() {
    return this.settings.get();
  }

  @Put('assistant')
  @RequirePermissions(PERMISSIONS.admin.settings)
  save(@Body(new ZodPipe(assistantSettingsSchema)) body: AssistantSettingsInput) {
    return this.settings.save(body);
  }

  @Post('conversations/:id/assistant')
  @RequirePermissions(PERMISSIONS.messaging.send)
  setForConversation(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(conversationAssistantSchema)) body: ConversationAssistantInput) {
    return this.settings.setForConversation(id, body.action);
  }
}
