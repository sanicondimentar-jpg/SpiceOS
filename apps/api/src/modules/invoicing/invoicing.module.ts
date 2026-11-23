import { Module } from '@nestjs/common';
import { FiscalSettingsService } from './fiscal-settings.service';
import { InvoicingController } from './invoicing.controller';
import { InvoicingService } from './invoicing.service';

@Module({
  controllers: [InvoicingController],
  providers: [FiscalSettingsService, InvoicingService],
  exports: [FiscalSettingsService, InvoicingService],
})
export class InvoicingModule {}
