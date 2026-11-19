import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  collectionSettingsSchema,
  createCustomerChargeSchema,
  createCustomerPaymentSchema,
  updateCustomerChargeSchema,
  type CollectionSettingsInput,
  type CreateCustomerChargeInput,
  type CreateCustomerPaymentInput,
  type UpdateCustomerChargeInput,
} from '@spiceos/contracts';
import type { Response } from 'express';
import { RequirePermissions } from '../../shared/auth/decorators';
import { BusinessRuleError } from '../../shared/domain/errors';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { PROOF_MAX_BYTES, type ProofFile } from '../purchasing/supplier-accounts.service';
import { CollectionRemindersService } from './collection-reminders.service';
import { CollectionsService } from './collections.service';

const upload = FileInterceptor('file', { limits: { fileSize: PROOF_MAX_BYTES, files: 1 } });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function proofOf(file: Express.Multer.File | undefined): ProofFile | null {
  if (!file) return null;
  const name = Buffer.from(file.originalname || 'comprobante', 'latin1').toString('utf8').slice(0, 200);
  return { data: file.buffer, mimeType: file.mimetype, name };
}

const READ = PERMISSIONS.receivables.read;
const WRITE = PERMISSIONS.receivables.write;

/** Cobranza a clientes: saldos, deudas, cobros en efectivo o en cuenta con comprobante y avisos. */
@ApiTags('Cobranza')
@ApiBearerAuth()
@Controller()
export class CollectionsController {
  constructor(
    private readonly collections: CollectionsService,
    private readonly reminders: CollectionRemindersService,
  ) {}

  /** from/to: "2026-11-01" (por defecto, el mes en curso). */
  @Get('collections')
  @RequirePermissions(READ)
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    if ((from && !DAY.test(from)) || (to && !DAY.test(to))) throw new BusinessRuleError('Fechas con formato AAAA-MM-DD');
    return this.collections.summary(from, to);
  }

  @Get('collections/settings')
  @RequirePermissions(READ)
  settings() {
    return this.collections.getSettings();
  }

  @Put('collections/settings')
  @RequirePermissions(PERMISSIONS.admin.settings)
  saveSettings(@Body(new ZodPipe(collectionSettingsSchema)) body: CollectionSettingsInput) {
    return this.collections.saveSettings(body);
  }

  @Post('collections/reminders/run')
  @HttpCode(200)
  @RequirePermissions(WRITE)
  runReminders() {
    return this.reminders.run();
  }

  @Get('customer-accounts/:customerId')
  @RequirePermissions(READ)
  statement(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.collections.statement(customerId);
  }

  @Post('customer-accounts/:customerId/charges')
  @RequirePermissions(WRITE)
  createCharge(@Param('customerId', ParseUUIDPipe) customerId: string, @Body(new ZodPipe(createCustomerChargeSchema)) body: CreateCustomerChargeInput) {
    return this.collections.createCharge(customerId, body);
  }

  @Patch('customer-charges/:id')
  @RequirePermissions(WRITE)
  updateCharge(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateCustomerChargeSchema)) body: UpdateCustomerChargeInput) {
    return this.collections.updateCharge(id, body);
  }

  @Post('customer-charges/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(WRITE)
  cancelCharge(@Param('id', ParseUUIDPipe) id: string) {
    return this.collections.cancelCharge(id);
  }

  @Post('customer-charges/:id/remind')
  @HttpCode(200)
  @RequirePermissions(WRITE, PERMISSIONS.messaging.send)
  remind(@Param('id', ParseUUIDPipe) id: string) {
    return this.reminders.remindCustomer(id);
  }

  /** multipart: file (comprobante, opcional), date, cashAmount, accountAmount, accountMethod, reference, notes, collectedBy, chargeIds, orderId. */
  @Post('customer-accounts/:customerId/payments')
  @ApiConsumes('multipart/form-data')
  @RequirePermissions(WRITE)
  @UseInterceptors(upload)
  createPayment(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodPipe(createCustomerPaymentSchema)) body: CreateCustomerPaymentInput,
  ) {
    return this.collections.createPayment(customerId, body, proofOf(file));
  }

  @Post('customer-payments/:id/proof')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions(WRITE)
  @UseInterceptors(upload)
  attachProof(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    const proof = proofOf(file);
    if (!proof) throw new BusinessRuleError('Falta la foto o el PDF del comprobante (campo "file")');
    return this.collections.attachProof(id, proof);
  }

  @Get('customer-payments/:id/proof')
  @RequirePermissions(READ)
  async proof(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.collections.proof(id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(file.data);
  }

  @Post('customer-payments/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(WRITE)
  cancelPayment(@Param('id', ParseUUIDPipe) id: string) {
    return this.collections.cancelPayment(id);
  }
}
