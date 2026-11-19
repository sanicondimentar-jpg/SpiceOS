import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  PERMISSIONS,
  confirmPendingReceiptSchema,
  createApiKeySchema,
  createPendingReceiptSchema,
  type ConfirmPendingReceiptInput,
  type CreateApiKeyInput,
  type CreatePendingReceiptInput,
} from '@spiceos/contracts';
import type { Response } from 'express';
import { RequirePermissions } from '../../shared/auth/decorators';
import { BusinessRuleError } from '../../shared/domain/errors';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { ApiKeysService } from './api-keys.service';
import { PendingReceiptsService } from './pending-receipts.service';
import { ReceiptReaderService } from './receipt-reader.service';
import { MAX_READ_BYTES } from './receipt-reading';

const upload = FileInterceptor('file', { limits: { fileSize: MAX_READ_BYTES, files: 1 } });

function requireFile(file: Express.Multer.File | undefined) {
  if (!file) throw new BusinessRuleError('Falta la foto o el PDF del remito (campo "file")');
  return { data: file.buffer, mediaType: file.mimetype };
}

/** Remitos de compra leídos con IA y los que esperan confirmación. */
@ApiTags('Remitos de compra')
@ApiBearerAuth()
@Controller('receipts')
export class ReceiptsController {
  constructor(
    private readonly reader: ReceiptReaderService,
    private readonly pending: PendingReceiptsService,
  ) {}

  /** Lee la foto o el PDF y devuelve los renglones para revisar en el formulario. No guarda nada. */
  @Post('read')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions(PERMISSIONS.inventory.adjust)
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  @UseInterceptors(upload)
  read(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.reader.read(requireFile(file));
  }

  /**
   * Deja un remito por confirmar. Lo usan las integraciones con clave de acceso (Claude);
   * la clave solo puede llamar a este endpoint (ver AuthMiddleware).
   */
  @Post('pending')
  @ApiConsumes('multipart/form-data')
  @Throttle({ default: { limit: 60, ttl: 3_600_000 } })
  @UseInterceptors(upload)
  create(@UploadedFile() file: Express.Multer.File | undefined, @Body(new ZodPipe(createPendingReceiptSchema)) body: CreatePendingReceiptInput) {
    const ctx = RequestContextStore.get();
    const integration = ctx.actorType === 'INTEGRATION';
    if (!integration && !ctx.permissions.has(PERMISSIONS.inventory.adjust)) throw new ForbiddenException(`Faltan permisos: ${PERMISSIONS.inventory.adjust}`);
    return this.pending.create({
      source: 'API',
      file: requireFile(file),
      supplierCode: body.supplierCode,
      note: body.note,
      sender: integration ? ctx.actor.replace(/^apikey:/, '') : null,
    });
  }

  @Get('pending')
  @RequirePermissions(PERMISSIONS.inventory.read)
  list(@Query('status') status?: string) {
    return this.pending.list(status === 'ALL' ? 'ALL' : 'PENDING');
  }

  @Get('pending/:id')
  @RequirePermissions(PERMISSIONS.inventory.read)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.pending.get(id);
  }

  @Get('pending/:id/image')
  @RequirePermissions(PERMISSIONS.inventory.read)
  async image(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.pending.image(id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(file.data);
  }

  @Post('pending/:id/discard')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.inventory.adjust)
  discard(@Param('id', ParseUUIDPipe) id: string) {
    return this.pending.discard(id);
  }

  @Post('pending/:id/confirm')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.inventory.adjust)
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(confirmPendingReceiptSchema)) body: ConfirmPendingReceiptInput) {
    return this.pending.confirm(id, body);
  }
}

/** Claves de acceso para integraciones (hoy: Claude dejando remitos por confirmar). */
@ApiTags('Configuración')
@ApiBearerAuth()
@Controller('settings/api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.admin.settings)
  list() {
    return this.keys.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.admin.settings)
  create(@Body(new ZodPipe(createApiKeySchema)) body: CreateApiKeyInput) {
    return this.keys.create(body);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.admin.settings)
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.keys.revoke(id);
  }
}
