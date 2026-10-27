import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CatalogModule } from '../catalog/catalog.module';
import { CrmModule } from '../crm/crm.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [CqrsModule, CrmModule, CatalogModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
