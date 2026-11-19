import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  createSupplierPaymentSchema,
  createSupplierPurchaseSchema,
  updateSupplierPurchaseSchema,
  type CreateSupplierPaymentInput,
  type CreateSupplierPurchaseInput,
  type UpdateSupplierPurchaseInput,
} from '@spiceos/contracts';
import type { Response } from 'express';
import { RequirePermissions } from '../../shared/auth/decorators';
import { BusinessRuleError } from '../../shared/domain/errors';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { PROOF_MAX_BYTES, SupplierAccountsService, type ProofFile } from './supplier-accounts.service';

const upload = FileInterceptor('file', { limits: { fileSize: PROOF_MAX_BYTES, files: 1 } });

function proofOf(file: Express.Multer.File | undefined): ProofFile | null {
  if (!file) return null;
  // multer entrega el nombre en latin1.
  const name = Buffer.from(file.originalname || 'comprobante', 'latin1').toString('utf8').slice(0, 200);
  return { data: file.buffer, mimeType: file.mimetype, name };
}

// Los montos son costos: además del permiso de compras hace falta ver costos.
const READ = [PERMISSIONS.purchasing.read, PERMISSIONS.catalog.costRead] as const;
const WRITE = [PERMISSIONS.purchasing.write, PERMISSIONS.catalog.costRead] as const;

/** Cuenta corriente con proveedores: compras, pagos con comprobante y saldo. */
@ApiTags('Compras')
@ApiBearerAuth()
@Controller()
export class SupplierAccountsController {
  constructor(private readonly accounts: SupplierAccountsService) {}

  @Get('supplier-accounts')
  @RequirePermissions(...READ)
  list() {
    return this.accounts.list();
  }

  @Get('supplier-accounts/:supplierId')
  @RequirePermissions(...READ)
  get(@Param('supplierId', ParseUUIDPipe) supplierId: string) {
    return this.accounts.get(supplierId);
  }

  @Post('supplier-accounts/:supplierId/purchases')
  @RequirePermissions(...WRITE)
  createPurchase(@Param('supplierId', ParseUUIDPipe) supplierId: string, @Body(new ZodPipe(createSupplierPurchaseSchema)) body: CreateSupplierPurchaseInput) {
    return this.accounts.createPurchase(supplierId, body);
  }

  @Patch('supplier-purchases/:id')
  @RequirePermissions(...WRITE)
  updatePurchase(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSupplierPurchaseSchema)) body: UpdateSupplierPurchaseInput) {
    return this.accounts.updatePurchase(id, body);
  }

  @Post('supplier-purchases/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(...WRITE)
  cancelPurchase(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.cancelPurchase(id);
  }

  /** multipart: file (comprobante, opcional), date, method, amount, reference, notes, purchaseIds (separados por coma). */
  @Post('supplier-accounts/:supplierId/payments')
  @ApiConsumes('multipart/form-data')
  @RequirePermissions(...WRITE)
  @UseInterceptors(upload)
  createPayment(
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodPipe(createSupplierPaymentSchema)) body: CreateSupplierPaymentInput,
  ) {
    return this.accounts.createPayment(supplierId, body, proofOf(file));
  }

  @Post('supplier-payments/:id/proof')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @RequirePermissions(...WRITE)
  @UseInterceptors(upload)
  attachProof(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    const proof = proofOf(file);
    if (!proof) throw new BusinessRuleError('Falta la foto o el PDF del comprobante (campo "file")');
    return this.accounts.attachProof(id, proof);
  }

  @Get('supplier-payments/:id/proof')
  @RequirePermissions(...READ)
  async proof(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.accounts.proof(id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(file.data);
  }

  @Post('supplier-payments/:id/cancel')
  @HttpCode(200)
  @RequirePermissions(...WRITE)
  cancelPayment(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.cancelPayment(id);
  }
}
