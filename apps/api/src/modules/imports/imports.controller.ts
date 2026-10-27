import { Controller, Get, Param, ParseEnumPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, importOptionsSchema, type ImportOptions } from '@spiceos/contracts';
import type { Response } from 'express';
import { RequirePermissions } from '../../shared/auth/decorators';
import { BusinessRuleError } from '../../shared/domain/errors';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { ImportsService } from './imports.service';

const upload = FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

/** Importación desde Excel/CSV. Por defecto dryRun=true: valida y muestra errores sin guardar. */
@ApiTags('Importación')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('customers')
  @ApiConsumes('multipart/form-data')
  @RequirePermissions(PERMISSIONS.crm.customerWrite)
  @UseInterceptors(upload)
  customers(@UploadedFile() file: Express.Multer.File | undefined, @Query(new ZodPipe(importOptionsSchema)) options: ImportOptions) {
    return this.imports.importCustomers(requireFile(file), options);
  }

  @Post('products')
  @ApiConsumes('multipart/form-data')
  @RequirePermissions(PERMISSIONS.catalog.write, PERMISSIONS.catalog.costRead)
  @UseInterceptors(upload)
  products(@UploadedFile() file: Express.Multer.File | undefined, @Query(new ZodPipe(importOptionsSchema)) options: ImportOptions) {
    return this.imports.importProducts(requireFile(file), options);
  }

  @Get('templates/:kind')
  @RequirePermissions(PERMISSIONS.crm.customerRead)
  async template(@Param('kind', new ParseEnumPipe(['customers', 'products'])) kind: 'customers' | 'products', @Res() res: Response) {
    const buffer = await this.imports.template(kind);
    res
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="plantilla-${kind === 'customers' ? 'clientes' : 'productos'}.xlsx"`,
      })
      .send(buffer);
  }
}

function requireFile(file: Express.Multer.File | undefined) {
  if (!file) throw new BusinessRuleError('Falta el archivo (campo "file")');
  return file;
}
