import { z } from 'zod';
import { ALL_PERMISSIONS, type PermissionKey } from './permissions';

// ---------------------------------------------------------------------------
// Usuarios, roles y permisos (Configuración → Usuarios y permisos).
// ---------------------------------------------------------------------------

export const ADMIN_ROLE_KEY = 'admin';

const permissionKey = z.enum(ALL_PERMISSIONS as [PermissionKey, ...PermissionKey[]]);

export const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: z.array(permissionKey).max(200),
});
export type RoleInput = z.infer<typeof roleSchema>;

export const updateStaffUserSchema = z.object({
  roleId: z.string().uuid().optional(),
  /** Celular personal: si escribe al WhatsApp de la empresa, la IA lo reconoce. null lo desvincula. */
  phone: z
    .string()
    .trim()
    .regex(/^[\d\s+()-]{10,25}$/, 'Celular con característica, ej. 11 5906-3462')
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
});
export type UpdateStaffUserInput = z.infer<typeof updateStaffUserSchema>;

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  /** El rol Dueño siempre tiene todos los permisos: no se edita. */
  locked: boolean;
  permissions: PermissionKey[];
  users: number;
}

export interface StaffUserView {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  role: { id: string; key: string; name: string };
  lastLoginAt: string | null;
}

// ---------------------------------------------------------------------------
// Órdenes a la IA: lo que dueños y gerentes le piden a la IA por WhatsApp.
// ---------------------------------------------------------------------------

export const AI_ORDER_STATUSES = ['DONE', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'FAILED'] as const;
export type AiOrderStatus = (typeof AI_ORDER_STATUSES)[number];

export interface AiOrderAction {
  tool: string;
  /** En palabras: qué hizo (o qué intentó hacer). */
  summary: string;
  ok: boolean;
}

export interface AiOrderView {
  id: string;
  createdAt: string;
  user: { id: string; name: string };
  request: string;
  reply: string | null;
  status: AiOrderStatus;
  actions: AiOrderAction[];
  /** Acción que esperó (o espera) un "sí". */
  pending: { summary: string } | null;
  confirmedAt: string | null;
}

export const aiOrderListQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type AiOrderListQuery = z.infer<typeof aiOrderListQuerySchema>;

export const aiInstructionSchema = z.object({
  text: z.string().trim().min(3).max(500),
  /** Hasta cuándo vale (inclusive). Vacío = hasta que la corten. */
  until: z.string().date().nullable().optional(),
});
export type AiInstructionInput = z.infer<typeof aiInstructionSchema>;

export interface AiInstructionView {
  id: string;
  text: string;
  until: string | null;
  createdAt: string;
  createdBy: string;
  /** Desde dónde se dio: WhatsApp o la pantalla. */
  source: 'whatsapp' | 'web';
  active: boolean;
  revokedAt: string | null;
  revokedBy: string | null;
}
