import { Module } from '@nestjs/common';
import { CoreController } from './core.controller';
import { StaffAdminController } from './staff-admin.controller';
import { StaffAdminService } from './staff-admin.service';

@Module({ controllers: [CoreController, StaffAdminController], providers: [StaffAdminService] })
export class CoreModule {}
