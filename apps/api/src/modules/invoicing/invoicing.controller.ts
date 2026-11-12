import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PERMISSIONS,
  arcaCertificateSchema,
  creditNoteSchema,
  fiscalSettingsSchema,
  invoiceListQuerySchema,
  type ArcaCertificateInput,
  type CreditNoteInput,
  type FiscalSettingsInput,
  type InvoiceListQuery,
} from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { DEFAULT_CONDITION, FiscalSettingsService } from './fiscal-settings.service';
import { InvoicingService } from './invoicing.service';

@ApiTags('Facturación')
@ApiBearerAuth()
@Controller('invoicing')
export class InvoicingController {
  constructor(
    private readonly fiscal: FiscalSettingsService,
    private readonly invoicing: InvoicingService,
  ) {}

  // ---------- Configuración (datos fiscales y certificado de ARCA) ----------
  @Get('settings')
  @RequirePermissions(PERMISSIONS.admin.settings)
  settings() {
    return this.fiscal.get();
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.admin.settings)
  saveSettings(@Body(new ZodPipe(fiscalSettingsSchema)) body: FiscalSettingsInput) {
    return this.fiscal.save(body);
  }

  @Post('settings/csr')
  @RequirePermissions(PERMISSIONS.admin.settings)
  generateCsr() {
    return this.fiscal.generateCsr();
  }

  @Put('settings/certificate')
  @RequirePermissions(PERMISSIONS.admin.settings)
  saveCertificate(@Body(new ZodPipe(arcaCertificateSchema)) body: ArcaCertificateInput) {
    return this.fiscal.saveCertificate(body);
  }

  @Post('settings/test')
  @RequirePermissions(PERMISSIONS.admin.settings)
  test() {
    return this.fiscal.test();
  }

  /** Lo que necesitan las pantallas de pedidos: si se suma IVA y si ya se puede facturar. */
  @Get('status')
  @RequirePermissions(PERMISSIONS.orders.read)
  async status() {
    const { settings } = await this.fiscal.get();
    return { taxCondition: settings?.taxCondition ?? DEFAULT_CONDITION, ready: !!settings?.ready, testing: settings?.environment === 'TESTING' };
  }

  // ---------- Comprobantes ----------
  @Get('invoices')
  @RequirePermissions(PERMISSIONS.invoicing.read)
  list(@Query(new ZodPipe(invoiceListQuerySchema)) query: InvoiceListQuery) {
    return this.invoicing.list(query);
  }

  @Get('invoices/:id/pdf')
  @RequirePermissions(PERMISSIONS.invoicing.read)
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { buffer, filename } = await this.invoicing.pdf(id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` }).send(buffer);
  }

  @Post('invoices/:id/credit-note')
  @RequirePermissions(PERMISSIONS.invoicing.issue)
  creditNote(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(creditNoteSchema)) body: CreditNoteInput) {
    return this.invoicing.creditNote(id, body.reason);
  }

  @Get('orders/:orderId')
  @RequirePermissions(PERMISSIONS.orders.read)
  forOrder(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.invoicing.forOrder(orderId);
  }

  @Post('orders/:orderId')
  @RequirePermissions(PERMISSIONS.invoicing.issue)
  issue(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.invoicing.issueForOrder(orderId);
  }
}
