'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConvertQuoteInput, CreateQuoteInput, QuoteStatusInput, UpdateQuoteInput } from '@spiceos/contracts';
import { api } from './api';

export type QuoteStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Falta aprobar',
  SENT: 'Enviado',
  ACCEPTED: 'Pasado a pedido',
  REJECTED: 'Rechazado',
  EXPIRED: 'Vencido',
};

export const QUOTE_STATUS_TONE: Record<QuoteStatus, 'neutral' | 'good' | 'warn' | 'bad' | 'brand'> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warn',
  SENT: 'brand',
  ACCEPTED: 'good',
  REJECTED: 'bad',
  EXPIRED: 'warn',
};

/** Abiertos: todavía se pueden editar, enviar o pasar a pedido. */
export const OPEN_QUOTE: QuoteStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'SENT', 'EXPIRED'];

export interface QuoteRow {
  id: string;
  number: string;
  status: QuoteStatus;
  customerId: string;
  customer: string;
  total: number;
  withInvoice: boolean;
  taxTotal: number;
  grandTotal: number;
  lines: number;
  validUntil: string | null;
  order: { id: string; number: string } | null;
  createdAt: string;
}

export interface QuoteDetail {
  id: string;
  number: string;
  status: QuoteStatus;
  storedStatus: QuoteStatus;
  version: number;
  branchId: string;
  customer: { id: string; legalName: string; tradeName: string | null; taxId: string | null; phone: string | null };
  validUntil: string | null;
  notes: string | null;
  rejectReason: string | null;
  requiresApproval: boolean;
  subtotal: number;
  discountTotal: number;
  total: number;
  withInvoice: boolean;
  taxTotal: number;
  grandTotal: number;
  marginTotal?: number;
  order: { id: string; number: string; status: string } | null;
  createdAt: string;
  lines: { id: string; variantId: string; sku: string; description: string; quantity: number; unitPrice: number; discountPct: number; lineTotal: number }[];
}

export const useQuotes = (status: QuoteStatus | '', q: string) =>
  useQuery({
    queryKey: ['quotes', status, q],
    queryFn: () => api<QuoteRow[]>(`/sales/quotes?${new URLSearchParams({ ...(status && { status }), ...(q.trim() && { q: q.trim() }) })}`),
  });

export const useQuote = (id: string) => useQuery({ queryKey: ['quotes', id], queryFn: () => api<QuoteDetail>(`/sales/quotes/${id}`) });

function useQuoteMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['quotes'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

const post = (path: string, body: unknown) => ({ method: 'POST', body: JSON.stringify(body) }) as RequestInit;

export const useCreateQuote = () =>
  useQuoteMutation((input: CreateQuoteInput) => api<{ id: string; number: string; status: QuoteStatus }>('/sales/quotes', post('', input)));

export const useUpdateQuote = (id: string) =>
  useQuoteMutation((input: UpdateQuoteInput) => api<{ id: string; version: number }>(`/sales/quotes/${id}`, { method: 'PATCH', body: JSON.stringify(input) }));

export const useQuoteStatus = (id: string) =>
  useQuoteMutation((input: QuoteStatusInput) => api<{ id: string; status: QuoteStatus }>(`/sales/quotes/${id}/status`, post('', input)));

export const useApproveQuote = (id: string) => useQuoteMutation(() => api<{ id: string }>(`/sales/quotes/${id}/approve`, { method: 'POST' }));

export const useConvertQuote = (id: string) =>
  useQuoteMutation((input: ConvertQuoteInput) => api<{ orderId: string; orderNumber: string }>(`/sales/quotes/${id}/convert`, post('', input)));

/** Fecha guardada sin hora (AAAA-MM-DD): se muestra tal cual, sin correrla por zona horaria. */
export function day(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
}
