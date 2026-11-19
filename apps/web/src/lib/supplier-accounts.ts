'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateSupplierPurchaseInput,
  SupplierAccountDetail,
  SupplierAccountSummary,
  SupplierPaymentMethod,
  SupplierPurchaseStatus,
  UpdateSupplierPurchaseInput,
} from '@spiceos/contracts';
import { api } from './api';
import { shrinkForUpload } from './receipts';

export { SUPPLIER_PAYMENT_METHOD_LABEL, SUPPLIER_PAYMENT_METHODS } from '@spiceos/contracts';

export const PURCHASE_STATUS_LABEL: Record<SupplierPurchaseStatus, string> = {
  UNPAID: 'A pagar',
  PARTIAL: 'Pagada en parte',
  PAID: 'Pagada',
  CANCELLED: 'Anulada',
};
export const PURCHASE_STATUS_TONE: Record<SupplierPurchaseStatus, 'neutral' | 'brand' | 'warn' | 'good' | 'bad'> = {
  UNPAID: 'warn',
  PARTIAL: 'brand',
  PAID: 'good',
  CANCELLED: 'neutral',
};

/** "2026-10-30" → "30/10/2026" sin pasar por la zona horaria. */
export const day = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const useSupplierAccounts = () => useQuery({ queryKey: ['supplier-accounts'], queryFn: () => api<SupplierAccountSummary[]>('/supplier-accounts') });

export const useSupplierAccount = (supplierId: string) =>
  useQuery({ queryKey: ['supplier-accounts', supplierId], queryFn: () => api<SupplierAccountDetail>(`/supplier-accounts/${supplierId}`) });

function useInvalidating<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-accounts'] }) });
}

export interface NewPaymentInput {
  date: string;
  method: SupplierPaymentMethod;
  amount: number;
  reference?: string;
  notes?: string;
  purchaseIds: string[];
  file?: File | null;
}

async function proofBody(file: File) {
  const blob = await shrinkForUpload(file);
  return { blob, name: blob === file ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg' };
}

export const useCreateSupplierPayment = (supplierId: string) =>
  useInvalidating(async (input: NewPaymentInput) => {
    const body = new FormData();
    body.append('date', input.date);
    body.append('method', input.method);
    body.append('amount', String(input.amount));
    if (input.reference) body.append('reference', input.reference);
    if (input.notes) body.append('notes', input.notes);
    body.append('purchaseIds', input.purchaseIds.join(','));
    if (input.file) {
      const { blob, name } = await proofBody(input.file);
      body.append('file', blob, name);
    }
    return api<{ id: string; unallocated: number }>(`/supplier-accounts/${supplierId}/payments`, { method: 'POST', body });
  });

export const useAttachPaymentProof = () =>
  useInvalidating(async ({ id, file }: { id: string; file: File }) => {
    const body = new FormData();
    const { blob, name } = await proofBody(file);
    body.append('file', blob, name);
    return api<{ id: string }>(`/supplier-payments/${id}/proof`, { method: 'POST', body });
  });

export const useCancelSupplierPayment = () => useInvalidating((id: string) => api<{ id: string }>(`/supplier-payments/${id}/cancel`, { method: 'POST' }));

export const useCreateSupplierPurchase = (supplierId: string) =>
  useInvalidating((input: CreateSupplierPurchaseInput) => api<{ id: string }>(`/supplier-accounts/${supplierId}/purchases`, { method: 'POST', body: JSON.stringify(input) }));

export const useUpdateSupplierPurchase = () =>
  useInvalidating(({ id, ...input }: UpdateSupplierPurchaseInput & { id: string }) => api<{ id: string }>(`/supplier-purchases/${id}`, { method: 'PATCH', body: JSON.stringify(input) }));

export const useCancelSupplierPurchase = () => useInvalidating((id: string) => api<{ id: string }>(`/supplier-purchases/${id}/cancel`, { method: 'POST' }));
