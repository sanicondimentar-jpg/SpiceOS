import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ALL_PERMISSIONS,
  roleSchema,
  updateStaffUserSchema,
  type RoleInput,
  type UpdateStaffUserInput,
} from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { StaffAdminService } from './staff-admin.service';

@ApiTags('Usuarios y permisos')
@ApiBearerAuth()
@Controller('admin')
@RequirePermissions(PERMISSIONS.admin.users)
export class StaffAdminController {
  constructor(private readonly staff: StaffAdminService) {}

  @Get('users')
  users() {
    return this.staff.users();
  }

  @Patch('users/:id')
  updateUser(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateStaffUserSchema)) body: UpdateStaffUserInput) {
    return this.staff.updateUser(id, body);
  }

  @Get('roles')
  roles() {
    return this.staff.roles();
  }

  /** Catálogo de permisos con su nombre en castellano, agrupados por área. */
  @Get('permissions')
  permissions() {
    return PERMISSION_GROUPS.map((g) => ({
      label: g.label,
      permissions: ALL_PERMISSIONS.filter((p) => g.prefix.some((x) => p.startsWith(x))).map((key) => ({ key, label: PERMISSION_LABELS[key] })),
    }));
  }

  @Post('roles')
  createRole(@Body(new ZodPipe(roleSchema)) body: RoleInput) {
    return this.staff.createRole(body);
  }

  @Put('roles/:id')
  updateRole(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(roleSchema)) body: RoleInput) {
    return this.staff.updateRole(id, body);
  }

  @Delete('roles/:id')
  deleteRole(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.deleteRole(id);
  }
}
