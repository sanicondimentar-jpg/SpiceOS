import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  PERMISSIONS,
  conversationListQuerySchema,
  sendMessageSchema,
  updateConversationSchema,
  whatsappAccountSchema,
  whatsappProfileSchema,
  type ConversationListQuery,
  type SendMessageInput,
  type UpdateConversationInput,
  type WhatsappAccountInput,
  type WhatsappProfileInput,
} from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { ConversationsService } from './conversations.service';
import { MAX_PROFILE_PHOTO_BYTES, WhatsappAccountService } from './whatsapp-account.service';

@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('messaging/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.messaging.read)
  list(@Query(new ZodPipe(conversationListQuerySchema)) query: ConversationListQuery) {
    return this.conversations.list(query);
  }

  @Get('unread')
  @RequirePermissions(PERMISSIONS.messaging.read)
  unread() {
    return this.conversations.unread();
  }

  @Get('messages/:messageId/media')
  @RequirePermissions(PERMISSIONS.messaging.read)
  async media(@Param('messageId', ParseUUIDPipe) messageId: string, @Res() res: Response) {
    const file = await this.conversations.media(messageId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(file.data);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.messaging.read)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.get(id);
  }

  @Post(':id/messages')
  @RequirePermissions(PERMISSIONS.messaging.send)
  send(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sendMessageSchema)) body: SendMessageInput) {
    return this.conversations.send(id, body.text);
  }

  @Post(':id/read')
  @RequirePermissions(PERMISSIONS.messaging.read)
  read(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.markRead(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.messaging.send)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateConversationSchema)) body: UpdateConversationInput) {
    return this.conversations.update(id, body);
  }

  @Post(':id/customer')
  @RequirePermissions(PERMISSIONS.crm.customerWrite)
  createCustomer(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.createCustomer(id);
  }
}

@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('messaging/whatsapp-account')
export class WhatsappAccountController {
  constructor(private readonly accounts: WhatsappAccountService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.admin.settings)
  get(@Req() req: Request) {
    return this.accounts.get(webhookUrl(req));
  }

  @Put()
  @RequirePermissions(PERMISSIONS.admin.settings)
  save(@Req() req: Request, @Body(new ZodPipe(whatsappAccountSchema)) body: WhatsappAccountInput) {
    return this.accounts.save(body, webhookUrl(req));
  }

  @Get('profile')
  @RequirePermissions(PERMISSIONS.admin.settings)
  profile() {
    return this.accounts.getProfile();
  }

  /** Foto (campo "photo", opcional) y textos del perfil público, en multipart. */
  @Put('profile')
  @ApiConsumes('multipart/form-data')
  @RequirePermissions(PERMISSIONS.admin.settings)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_PROFILE_PHOTO_BYTES, files: 1 } }))
  updateProfile(@UploadedFile() photo: Express.Multer.File | undefined, @Body(new ZodPipe(whatsappProfileSchema)) body: WhatsappProfileInput) {
    return this.accounts.updateProfile(body, photo && { data: photo.buffer, mimeType: photo.mimetype });
  }
}

/** Dirección pública del webhook (detrás de Caddy: protocolo y host del pedido original). */
function webhookUrl(req: Request) {
  return `${req.protocol}://${req.get('host')}/api/v1/integrations/whatsapp/webhook`;
}
