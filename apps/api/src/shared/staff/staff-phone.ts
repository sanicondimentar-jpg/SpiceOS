import type { PermissionKey } from '@spiceos/contracts';
import type { Tx } from '../prisma/prisma.service';

const digits = (s: string) => s.replace(/\D/g, '');

/**
 * Celular cargado a mano en la ficha del usuario → formato de WhatsApp (549 + característica + número).
 * Acepta "11 5906-3462", "+54 9 11 5906-3462", "011 15 5906 3462". Devuelve null si no se entiende.
 */
export function normalizeStaffPhone(raw: string): string | null {
  let d = digits(raw);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) d = d.slice(2);
  if (d.startsWith('9') && d.length === 11) d = d.slice(1);
  if (d.startsWith('0')) d = d.slice(1);
  // "11 15 5906-3462": el 15 después de la característica sobra en WhatsApp.
  if (d.length === 12 && /^\d{2,4}15/.test(d)) {
    for (const len of [2, 3, 4]) {
      if (d.slice(len, len + 2) === '15' && d.length - 2 === 10) {
        d = d.slice(0, len) + d.slice(len + 2);
        break;
      }
    }
  }
  return d.length === 10 ? `549${d}` : null;
}

/** ¿Es el mismo celular? Se comparan los últimos 10 dígitos (da igual el +54 o el 9). */
export function samePhone(a: string, b: string): boolean {
  const x = digits(a);
  const y = digits(b);
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
}

export interface StaffMember {
  userId: string;
  fullName: string;
  roleKey: string;
  roleName: string;
  permissions: Set<PermissionKey>;
  maxDiscount: number;
  branchScope: string[];
}

/** El usuario activo de esta empresa que tiene ese celular vinculado, o null si es un cliente. */
export async function findStaffByPhone(tx: Tx, waContactId: string): Promise<StaffMember | null> {
  const rows = await tx.membership.findMany({
    where: { isActive: true, user: { isActive: true, phone: { not: null } } },
    select: {
      userId: true,
      branchScope: true,
      user: { select: { fullName: true, phone: true } },
      role: { select: { key: true, name: true, maxDiscount: true, permissions: { select: { permissionKey: true } } } },
    },
  });
  const m = rows.find((r) => r.user.phone && samePhone(r.user.phone, waContactId));
  if (!m) return null;
  return {
    userId: m.userId,
    fullName: m.user.fullName,
    roleKey: m.role.key,
    roleName: m.role.name,
    permissions: new Set(m.role.permissions.map((p) => p.permissionKey as PermissionKey)),
    maxDiscount: Number(m.role.maxDiscount),
    branchScope: m.branchScope,
  };
}
