import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@spiceos/contracts';
import { RequestContextStore } from '../tenancy/request-context';
import { PERMISSIONS_KEY, PUBLIC_KEY } from './decorators';

/** Guard global: todo endpoint requiere usuario autenticado salvo @Public(); RBAC por @RequirePermissions(). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const ctx = RequestContextStore.tryGet();
    if (!ctx) throw new UnauthorizedException();

    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, targets) ?? [];
    const missing = required.filter((p) => !ctx.permissions.has(p));
    if (missing.length) throw new ForbiddenException(`Faltan permisos: ${missing.join(', ')}`);
    return true;
  }
}

/** Para casos de uso invocados fuera de HTTP (tools del copiloto, reglas). */
export function assertPermission(...required: PermissionKey[]): void {
  const ctx = RequestContextStore.get();
  const missing = required.filter((p) => !ctx.permissions.has(p));
  if (missing.length) throw new ForbiddenException(`Faltan permisos: ${missing.join(', ')}`);
}
