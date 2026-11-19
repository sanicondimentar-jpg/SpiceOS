import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, alertSettingsSchema, type AlertSettingsInput } from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { AlertsService } from './alerts.service';

@ApiTags('Automatizaciones')
@ApiBearerAuth()
@Controller('automation')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /** Avisos del día para la campanita y la pantalla de Automatizaciones (cada uno según los permisos del usuario). */
  @Get('alerts')
  list() {
    return this.alerts.alerts();
  }

  @Get('alert-settings')
  @RequirePermissions(PERMISSIONS.automation.read)
  settings() {
    return this.alerts.getSettings();
  }

  @Put('alert-settings')
  @RequirePermissions(PERMISSIONS.automation.write)
  save(@Body(new ZodPipe(alertSettingsSchema)) body: AlertSettingsInput) {
    return this.alerts.saveSettings(body);
  }
}
