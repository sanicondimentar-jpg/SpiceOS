'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChargeStatus,
  CollectionSettingsInput,
  CollectionsSummary,
  CreateCustomerChargeInput,
  CustomerAccountStatement,
  UpdateCustomerChargeInput,
} from '@spiceos/contracts';
import { api } from './api';
import { shrinkForUpload } from './receipts';

export {
  ACCOUNT_PAYMENT_METHODS,
  CUSTOMER_PAYMENT_METHOD_LABEL,
  PAYMENT_BUCKET_LABEL,
} from '@spiceos/contracts';
export { day, today } from './supplier-accounts';

export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = {
  UNPAID: 'A cobrar',
  PARTIAL: 'Cobrada en parte',
  PAID: 'Cobrada',
  CANCELLED: 'Anulada',
};
export const CHARGE_STATUS_TONE: Record<ChargeStatus, 'neutral' | 'brand' | 'warn' | 'good' | 'bad'> = {
  UNPAID: 'warn',
  PARTIAL: 'brand',
  PAID: 'good',
  CANCELLED: 'neutral',
};
export const NOTICE_LABEL: Record<string, string> = {
  OWNER_BEFORE: 'Aviso a vos antes del vencimiento',
  OWNER_DUE: 'Aviso a vos al vencer',
  CUSTOMER_DUE: 'Recordatorio al cliente al vencer',
  CUSTOMER_MANUAL: 'Recordatorio al cliente (a mano)',
};

export const useCollections = (from?: string, to?: string) =>
  useQuery({
    queryKey: ['collections', from ?? '', to ?? ''],
    queryFn: () => api<CollectionsSummary>(`/collections${from || to ? `?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}` : ''}`),
  });

export const useCustomerAccount = (customerId: string, enabled = true) =>
  useQuery({ queryKey: ['collections', 'customer', customerId], enabled, queryFn: () => api<CustomerAccountStatement>(`/customer-accounts/${customerId}`) });

export const useCollectionSettings = () =>
  useQuery({ queryKey: ['collections', 'settings'], queryFn: () => api<CollectionSettingsInput>('/collections/settings') });

function useInvalidating<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['collections'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export const useSaveCollectionSettings = () =>
  useInvalidating((input: CollectionSettingsInput) => api<CollectionSettingsInput>('/collections/settings', { method: 'PUT', body: JSON.stringify(input) }));

export const useRunReminders = () =>
  useInvalidating(() => api<{ sent: number; failed: number; pending: string[] }>('/collections/reminders/run', { method: 'POST' }));

export interface NewCollectionInput {
  date: string;
  cashAmount: number;
  accountAmount: number;
  accountMethod: string;
  reference?: string;
  notes?: string;
  collectedBy?: string;
  chargeIds: string[];
  orderId?: string;
  file?: File | null;
}

export const useCreateCustomerPayment = (customerId: string) =>
  useInvalidating(async (input: NewCollectionInput) => {
    const body = new FormData();
    body.append('date', input.date);
    body.append('cashAmount', String(input.cashAmount));
    body.append('accountAmount', String(input.accountAmount));
    body.append('accountMethod', input.accountMethod);
    if (input.reference) body.append('reference', input.reference);
    if (input.notes) body.append('notes', input.notes);
    if (input.collectedBy) body.append('collectedBy', input.collectedBy);
    body.append('chargeIds', input.chargeIds.join(','));
    if (input.orderId) body.append('orderId', input.orderId);
    if (input.file) {
      const blob = await shrinkForUpload(input.file);
      body.append('file', blob, blob === input.file ? input.file.name : input.file.name.replace(/\.[^.]+$/, '') + '.jpg');
    }
    return api<{ ids: string[]; unallocated: number }>(`/customer-accounts/${customerId}/payments`, { method: 'POST', body });
  });

export const useAttachCustomerProof = () =>
  useInvalidating(async ({ id, file }: { id: string; file: File }) => {
    const body = new FormData();
    const blob = await shrinkForUpload(file);
    body.append('file', blob, blob === file ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg');
    return api<{ id: string }>(`/customer-payments/${id}/proof`, { method: 'POST', body });
  });

export const useCancelCustomerPayment = () => useInvalidating((id: string) => api<{ id: string }>(`/customer-payments/${id}/cancel`, { method: 'POST' }));

export const useCreateCustomerCharge = (customerId: string) =>
  useInvalidating((input: CreateCustomerChargeInput) => api<{ id: string }>(`/customer-accounts/${customerId}/charges`, { method: 'POST', body: JSON.stringify(input) }));

export const useUpdateCustomerCharge = () =>
  useInvalidating(({ id, ...input }: UpdateCustomerChargeInput & { id: string }) => api<{ id: string }>(`/customer-charges/${id}`, { method: 'PATCH', body: JSON.stringify(input) }));

export const useCancelCustomerCharge = () => useInvalidating((id: string) => api<{ id: string }>(`/customer-charges/${id}/cancel`, { method: 'POST' }));

export const useRemindCustomer = () => useInvalidating((id: string) => api<{ ok: boolean }>(`/customer-charges/${id}/remind`, { method: 'POST' }));

/** "hace 3 días" / "vence en 5 días" / "vence hoy". */
export function dueText(daysOverdue: number | null) {
  if (daysOverdue === null) return '';
  if (daysOverdue === 0) return 'vence hoy';
  if (daysOverdue > 0) return `vencida hace ${daysOverdue} ${daysOverdue === 1 ? 'día' : 'días'}`;
  return `vence en ${-daysOverdue} ${daysOverdue === -1 ? 'día' : 'días'}`;
}
