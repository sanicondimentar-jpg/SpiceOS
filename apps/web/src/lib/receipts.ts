'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiKeySummary, ConfirmPendingReceiptInput, PendingReceiptDetail, PendingReceiptSummary, ReceiptReading } from '@spiceos/contracts';
import { api } from './api';

/**
 * Las fotos del celular pesan varios MB: se achican en el navegador (lado mayor 2000 px, JPEG)
 * antes de subirlas. Los PDF van tal cual.
 */
export async function shrinkForUpload(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo preparar la foto'))), 'image/jpeg', 0.85));
  } catch {
    return file;
  }
}

export const useReadReceipt = () =>
  useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      const blob = await shrinkForUpload(file);
      body.append('file', blob, blob === file ? file.name : 'remito.jpg');
      return api<ReceiptReading>('/receipts/read', { method: 'POST', body });
    },
  });

export const usePendingReceipts = (enabled = true) =>
  useQuery({ queryKey: ['pending-receipts'], queryFn: () => api<PendingReceiptSummary[]>('/receipts/pending'), enabled, refetchInterval: 60_000 });

export const usePendingReceipt = (id: string | null) =>
  useQuery({ queryKey: ['pending-receipts', id], queryFn: () => api<PendingReceiptDetail>(`/receipts/pending/${id}`), enabled: !!id });

function useInvalidating<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-receipts'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['movements'] });
    },
  });
}

export const useConfirmPendingReceipt = (id: string) =>
  useInvalidating((input: ConfirmPendingReceiptInput) => api<{ received: number }>(`/receipts/pending/${id}/confirm`, { method: 'POST', body: JSON.stringify(input) }));

export const useDiscardPendingReceipt = (id: string) =>
  useInvalidating(() => api<{ id: string }>(`/receipts/pending/${id}/discard`, { method: 'POST' }));

export const SOURCE_LABEL: Record<PendingReceiptSummary['source'], string> = { WHATSAPP: 'WhatsApp', API: 'Claude' };

export const useApiKeys = () => useQuery({ queryKey: ['api-keys'], queryFn: () => api<ApiKeySummary[]>('/settings/api-keys') });

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<{ id: string; key: string }>('/settings/api-keys', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/settings/api-keys/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });
}
