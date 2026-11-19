'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentEntity, DocumentKindValue, DocumentSummary, UpdateDocumentInput } from '@spiceos/contracts';
import { api, fetchBlob } from './api';

export { DOCUMENT_KIND_LABEL, DOCUMENT_KINDS } from '@spiceos/contracts';
export type { DocumentEntity, DocumentKindValue, DocumentSummary };

export interface DocumentDetail extends DocumentSummary {
  driveLink: string | null;
  versions: { id: string; versionNo: number; fileName: string | null; mimeType: string; sizeBytes: number | null; createdAt: string; createdBy: string | null; indexedAt: string | null }[];
}

export const ENTITY_LABEL: Record<DocumentEntity, string> = { product: 'Producto', supplier: 'Proveedor', customer: 'Cliente' };
export const entityHref = (t: DocumentEntity, id: string) => (t === 'product' ? `/products/${id}` : t === 'supplier' ? `/purchases/payments/${id}` : `/customers/${id}`);

export const useDocuments = (filter: { kind?: string; q?: string; entityType?: string; entityId?: string }) => {
  const p = new URLSearchParams(Object.entries(filter).filter(([, v]) => !!v) as [string, string][]);
  return useQuery({ queryKey: ['documents', filter], queryFn: () => api<DocumentSummary[]>(`/documents?${p}`), placeholderData: (prev) => prev });
};

export const useDocument = (id: string) => useQuery({ queryKey: ['documents', 'one', id], queryFn: () => api<DocumentDetail>(`/documents/${id}`) });

function useDocMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['automation'] });
    },
  });
}

export const useCreateDocument = () => useDocMutation((form: FormData) => api<DocumentDetail>('/documents', { method: 'POST', body: form }));
export const useAddVersion = (id: string) =>
  useDocMutation((form: FormData) => api<DocumentDetail & { unchanged: boolean }>(`/documents/${id}/versions`, { method: 'POST', body: form }));
export const useUpdateDocument = (id: string) =>
  useDocMutation((input: UpdateDocumentInput) => api<DocumentDetail>(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify(input) }));
export const useDeleteDocument = () => useDocMutation((id: string) => api<{ ok: true }>(`/documents/${id}`, { method: 'DELETE' }));

/** Abre el archivo (protegido) en otra pestaña. */
export function openDocument(id: string, versionId?: string) {
  const w = window.open('', '_blank');
  fetchBlob(`/documents/${id}/file${versionId ? `?version=${versionId}` : ''}`)
    .then((b) => {
      const url = URL.createObjectURL(b);
      if (w) w.location.href = url;
      else window.location.href = url;
    })
    .catch((e: Error) => {
      w?.close();
      alert(e.message);
    });
}

/** Días hasta el vencimiento (negativo si ya venció), en hora local. */
export function daysLeft(validUntil: string | null): number | null {
  if (!validUntil) return null;
  const today = new Date();
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.parse(`${validUntil}T00:00:00Z`) - t) / 86_400_000);
}

export const fileSize = (n: number | null) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const dayAr = (s: string) => s.slice(0, 10).split('-').reverse().join('/');
