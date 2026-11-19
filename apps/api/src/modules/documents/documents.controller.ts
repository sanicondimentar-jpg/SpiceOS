import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, createDocumentSchema, updateDocumentSchema, type CreateDocumentInput, type UpdateDocumentInput } from '@spiceos/contracts';
import type { Response } from 'express';
import { RequirePermissions } from '../../shared/auth/decorators';
import { BusinessRuleError } from '../../shared/domain/errors';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { DOCUMENT_MAX_BYTES, DocumentsLibraryService, type UploadedDoc } from './documents-library.service';

const upload = FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 } });
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const READ = PERMISSIONS.documents.read;
const WRITE = PERMISSIONS.documents.write;

function fileOf(file: Express.Multer.File | undefined): UploadedDoc | null {
  if (!file) return null;
  const name = Buffer.from(file.originalname || 'documento', 'latin1').toString('utf8').slice(0, 200);
  return { data: file.buffer, mimeType: file.mimetype, name };
}

/** Documentos del negocio: fichas técnicas, certificados, contratos, listas de proveedores. */
@ApiTags('Documentos')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsLibraryService) {}

  @Get()
  @RequirePermissions(READ)
  list(@Query('kind') kind?: string, @Query('q') q?: string, @Query('entityType') entityType?: string, @Query('entityId') entityId?: string) {
    return this.docs.list({ kind, q, entityType, entityId });
  }

  @Post()
  @RequirePermissions(WRITE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  create(@UploadedFile() file: Express.Multer.File | undefined, @Body(new ZodPipe(createDocumentSchema)) body: CreateDocumentInput) {
    return this.docs.create(body, fileOf(file));
  }

  @Get(':id')
  @RequirePermissions(READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.get(id);
  }

  @Patch(':id')
  @RequirePermissions(WRITE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateDocumentSchema)) body: UpdateDocumentInput) {
    return this.docs.update(id, body);
  }

  @Delete(':id')
  @RequirePermissions(WRITE)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.docs.remove(id);
  }

  /** Reemplaza el archivo por uno nuevo; validUntil opcional (el certificado renovado trae otra fecha). */
  @Post(':id/versions')
  @RequirePermissions(WRITE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  addVersion(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined, @Body('validUntil') validUntil?: string) {
    if (validUntil && !DAY.test(validUntil)) throw new BusinessRuleError('Fecha con formato AAAA-MM-DD');
    return this.docs.addVersion(id, fileOf(file), validUntil || undefined);
  }

  @Get(':id/file')
  @RequirePermissions(READ)
  async file(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response, @Query('version') version?: string, @Query('download') download?: string) {
    if (version && !/^[0-9a-f-]{36}$/i.test(version)) throw new BusinessRuleError('Versión inválida');
    const f = await this.docs.file(id, version || undefined);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(f.data);
  }
}
