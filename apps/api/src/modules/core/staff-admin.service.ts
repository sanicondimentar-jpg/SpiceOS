import { Injectable } from '@nestjs/common';
import { ADMIN_ROLE_KEY, ALL_PERMISSIONS, type PermissionKey, type RoleInput, type RoleView, type StaffUserView, type UpdateStaffUserInput } from '@spiceos/contracts';
import { BusinessRuleError, NotFoundError } from '../../shared/domain/errors';
import { normalizeStaffPhone, samePhone } from '../../shared/staff/staff-phone';
import type { Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';

/**
 * Usuarios, roles y permisos de la empresa. Los usuarios se crean con el workflow Deploy (Keycloak);
 * acá se elige su rol, se vincula su celular (para darle órdenes a la IA por WhatsApp) y se arman los roles.
 */
@Injectable()
export class StaffAdminService {
  constructor(private readonly uow: UnitOfWork) {}

  users(): Promise<StaffUserView[]> {
    return this.uow.read(async (tx) => {
      const rows = await tx.membership.findMany({
        include: { user: true, role: { select: { id: true, key: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((m) => ({
        id: m.userId,
        fullName: m.user.fullName,
        email: m.user.email,
        phone: m.user.phone,
        isActive: m.isActive && m.user.isActive,
        role: m.role,
        lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
      }));
    });
  }

  updateUser(userId: string, input: UpdateStaffUserInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const m = await tx.membership.findFirst({ where: { userId }, include: { user: true, role: true } });
      if (!m) throw new NotFoundError('Usuario', userId);
      const owners = () => tx.membership.count({ where: { isActive: true, role: { key: ADMIN_ROLE_KEY } } });

      if (input.roleId && input.roleId !== m.roleId) {
        const role = await tx.role.findFirst({ where: { id: input.roleId } });
        if (!role) throw new NotFoundError('Rol', input.roleId);
        if (m.role.key === ADMIN_ROLE_KEY && (await owners()) <= 1) throw new BusinessRuleError('Tiene que quedar al menos un Dueño');
        await tx.membership.update({ where: { id: m.id }, data: { roleId: role.id } });
      }
      if (input.isActive === false && userId === ctx.userId) throw new BusinessRuleError('No te podés desactivar a vos mismo');
      if (input.isActive !== undefined && input.isActive !== m.isActive) {
        if (!input.isActive && m.role.key === ADMIN_ROLE_KEY && (await owners()) <= 1) throw new BusinessRuleError('Tiene que quedar al menos un Dueño activo');
        await tx.membership.update({ where: { id: m.id }, data: { isActive: input.isActive } });
      }
      if (input.phone !== undefined) {
        const phone = input.phone ? normalizeStaffPhone(input.phone) : null;
        if (input.phone && !phone) throw new BusinessRuleError('No se entiende el celular: cargalo con la característica, por ejemplo 11 5906-3462');
        if (phone) {
          const others = await tx.membership.findMany({ where: { userId: { not: userId }, isActive: true, user: { phone: { not: null } } }, include: { user: true } });
          const taken = others.find((o) => samePhone(o.user.phone!, phone));
          if (taken) throw new BusinessRuleError(`Ese celular ya está vinculado a ${taken.user.fullName}`);
        }
        await tx.user.update({ where: { id: userId }, data: { phone } });
      }
      scope.auditLog({
        action: 'user.update',
        entityType: 'user',
        entityId: userId,
        before: { roleId: m.roleId, phone: m.user.phone, isActive: m.isActive },
        after: input,
      });
      return { id: userId };
    });
  }

  roles(): Promise<RoleView[]> {
    return this.uow.read(async (tx) => {
      const rows = await tx.role.findMany({
        include: { permissions: { select: { permissionKey: true } }, _count: { select: { memberships: { where: { isActive: true } } } } },
        orderBy: { createdAt: 'asc' },
      });
      // Primero el Dueño, después el resto en el orden en que se crearon.
      rows.sort((a, b) => Number(b.key === ADMIN_ROLE_KEY) - Number(a.key === ADMIN_ROLE_KEY));
      return rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        locked: r.key === ADMIN_ROLE_KEY,
        permissions: (r.key === ADMIN_ROLE_KEY ? ALL_PERMISSIONS : r.permissions.map((p) => p.permissionKey as PermissionKey)).filter((p) => ALL_PERMISSIONS.includes(p)),
        users: r._count.memberships,
      }));
    });
  }

  createRole(input: RoleInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const key = await this.uniqueKey(tx, input.name);
      const role = await tx.role.create({
        data: {
          tenantId: ctx.tenantId,
          key,
          name: input.name,
          description: input.description ?? null,
          permissions: { create: [...new Set(input.permissions)].map((permissionKey) => ({ permissionKey })) },
        },
      });
      scope.auditLog({ action: 'role.create', entityType: 'role', entityId: role.id, after: input });
      return { id: role.id };
    });
  }

  updateRole(id: string, input: RoleInput) {
    return this.uow.run(async (tx, scope) => {
      const role = await tx.role.findFirst({ where: { id }, include: { permissions: true } });
      if (!role) throw new NotFoundError('Rol', id);
      if (role.key === ADMIN_ROLE_KEY) throw new BusinessRuleError('El rol Dueño tiene siempre todos los permisos');
      await tx.role.update({ where: { id }, data: { name: input.name, description: input.description ?? null } });
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: [...new Set(input.permissions)].map((permissionKey) => ({ roleId: id, permissionKey })) });
      scope.auditLog({
        action: 'role.update',
        entityType: 'role',
        entityId: id,
        before: { name: role.name, permissions: role.permissions.map((p) => p.permissionKey) },
        after: input,
      });
      return { id };
    });
  }

  deleteRole(id: string) {
    return this.uow.run(async (tx, scope) => {
      const role = await tx.role.findFirst({ where: { id }, include: { _count: { select: { memberships: true } } } });
      if (!role) throw new NotFoundError('Rol', id);
      if (role.isSystem) throw new BusinessRuleError('Los roles de base no se borran: podés cambiarles los permisos');
      if (role._count.memberships) throw new BusinessRuleError('Hay usuarios con este rol: pasalos a otro antes de borrarlo');
      await tx.role.delete({ where: { id } });
      scope.auditLog({ action: 'role.delete', entityType: 'role', entityId: id, before: { name: role.name } });
      return { id };
    });
  }

  private async uniqueKey(tx: Tx, name: string) {
    const base =
      name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 30) || 'rol';
    for (let i = 1; ; i++) {
      const key = i === 1 ? base : `${base}_${i}`;
      if (!(await tx.role.findFirst({ where: { key }, select: { id: true } }))) return key;
    }
  }
}
