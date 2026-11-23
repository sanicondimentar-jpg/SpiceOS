import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { PortalService } from './portal.service';

/** Desde la ficha del cliente: ver quién entró al portal y cerrarle las sesiones. */
@ApiTags('Portal de clientes')
@ApiBearerAuth()
@Controller('crm/customers/:id/portal')
export class PortalAdminController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.crm.customerRead)
  access(@Param('id', ParseUUIDPipe) id: string) {
    return this.portal.access(id);
  }

  @Post('revoke')
  @RequirePermissions(PERMISSIONS.crm.customerWrite)
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.portal.revoke(id);
  }
}
