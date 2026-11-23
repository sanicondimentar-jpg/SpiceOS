'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiInstructionInput, AiInstructionView, AiOrderView, RoleInput, RoleView, StaffUserView, UpdateStaffUserInput } from '@spiceos/contracts';
import { api } from './api';

export interface PermissionGroup {
  label: string;
  permissions: { key: string; label: string }[];
}

// ─────────────── Usuarios, roles y permisos ───────────────

export const useStaffUsers = () => useQuery({ queryKey: ['admin', 'users'], queryFn: () => api<StaffUserView[]>('/admin/users') });
export const useRoles = () => useQuery({ queryKey: ['admin', 'roles'], queryFn: () => api<RoleView[]>('/admin/roles') });
export const usePermissionCatalog = () =>
  useQuery({ queryKey: ['admin', 'permissions'], queryFn: () => api<PermissionGroup[]>('/admin/permissions'), staleTime: Infinity });

function useAdminMutation<I>(fn: (input: I) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export const useUpdateStaffUser = () =>
  useAdminMutation(({ id, ...input }: UpdateStaffUserInput & { id: string }) => api(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }));
export const useCreateRole = () => useAdminMutation((input: RoleInput) => api<{ id: string }>('/admin/roles', { method: 'POST', body: JSON.stringify(input) }));
export const useUpdateRole = () =>
  useAdminMutation(({ id, ...input }: RoleInput & { id: string }) => api(`/admin/roles/${id}`, { method: 'PUT', body: JSON.stringify(input) }));
export const useDeleteRole = () => useAdminMutation((id: string) => api(`/admin/roles/${id}`, { method: 'DELETE' }));

// ─────────────── Órdenes a la IA ───────────────

export const useAiOrders = (userId?: string) =>
  useQuery({
    queryKey: ['ai-orders', userId ?? 'all'],
    queryFn: () => api<AiOrderView[]>(`/ai-orders?limit=200${userId ? `&userId=${userId}` : ''}`),
    refetchInterval: 30_000,
  });

export const useAiInstructions = (all: boolean) =>
  useQuery({ queryKey: ['ai-orders', 'instructions', all], queryFn: () => api<AiInstructionView[]>(`/ai-orders/instructions${all ? '?all=true' : ''}`) });

function useAiMutation<I>(fn: (input: I) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-orders'] }) });
}

export const useAddInstruction = () => useAiMutation((input: AiInstructionInput) => api('/ai-orders/instructions', { method: 'POST', body: JSON.stringify(input) }));
export const useRevokeInstruction = () => useAiMutation((id: string) => api(`/ai-orders/instructions/${id}/revoke`, { method: 'POST' }));
