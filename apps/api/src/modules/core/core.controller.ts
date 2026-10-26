import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { UnitOfWork } from '../../shared/unit-of-work';
import { RequestContextStore } from '../../shared/tenancy/request-context';

@ApiTags('Core')
@ApiBearerAuth()
@Controller()
export class CoreController {
  constructor(private readonly uow: UnitOfWork) {}

  /** Perfil, empresa activa, permisos y sucursales: la web arma menús y pantallas con esto. */
  @Get('me')
  me() {
    const ctx = RequestContextStore.get();
    return this.uow.read(async (tx) => ({
      user: await tx.user.findUnique({ where: { id: ctx.userId }, select: { id: true, fullName: true, email: true, avatarUrl: true } }),
      company: await tx.company.findUnique({ where: { id: ctx.tenantId }, select: { id: true, tradeName: true, legalName: true } }),
      role: ctx.roleKey,
      permissions: [...ctx.permissions],
      branches: await tx.branch.findMany({
        where: ctx.branchScope.length ? { id: { in: ctx.branchScope } } : {},
        select: { id: true, code: true, name: true },
      }),
      unreadNotifications: await tx.notification.count({ where: { userId: ctx.userId, readAt: null } }),
    }));
  }

  @Get('audit')
  @RequirePermissions(PERMISSIONS.admin.audit)
  audit(@Query('entityType') entityType?: string, @Query('entityId') entityId?: string) {
    return this.uow.read((tx) =>
      tx.auditLog.findMany({
        where: { ...(entityType && { entityType }), ...(entityId && { entityId }) },
        orderBy: { occurredAt: 'desc' },
        take: 200,
      }),
    );
  }
}
