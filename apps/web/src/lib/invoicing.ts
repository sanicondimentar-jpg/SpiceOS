'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FiscalSettingsInput } from '@spiceos/contracts';
import { api } from './api';

export interface FiscalSettingsView {
  taxCondition: 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO';
  cuit: string;
  legalName: string;
  address: string;
  grossIncomeId: string | null;
  activityStart: string | null;
  pointOfSale: number | null;
  environment: 'TESTING' | 'PRODUCTION';
  monotributoCategory: string | null;
  annualCap: number | null;
  hasKey: boolean;
  csr: string | null;
  hasCertificate: boolean;
  certificateExpiresAt: string | null;
  ready: boolean;
}

export interface FiscalInfo {
  settings: FiscalSettingsView | null;
  invoicedLast12Months: number;
}

export interface ArcaTestResult {
  pointsOfSale: { number: number; type: string; blocked: boolean; droppedAt: string | null }[];
  lastNumber: number | null;
  kind: string;
}

export interface InvoiceRow {
  id: string;
  type: string;
  label: string;
  number: string;
  issueDate: string;
  receiverName: string | null;
  receiverDocNumber: string | null;
  total: number;
  status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
  cae: string | null;
  caeDueDate: string | null;
  testing: boolean;
  orderId: string | null;
  orderNumber?: string | null;
  relatedInvoiceId: string | null;
}

export interface InvoicingStatus {
  taxCondition: 'MONOTRIBUTO' | 'RESPONSABLE_INSCRIPTO';
  ready: boolean;
  testing: boolean;
}

export const useFiscalSettings = () => useQuery({ queryKey: ['fiscal-settings'], queryFn: () => api<FiscalInfo>('/invoicing/settings') });

/** Si los pedidos suman IVA y si ya se puede facturar. Por defecto monotributo. */
export const useInvoicingStatus = () =>
  useQuery({ queryKey: ['invoicing-status'], queryFn: () => api<InvoicingStatus>('/invoicing/status'), staleTime: 5 * 60_000 });

function useSettingsMutation<I>(fn: (input: I) => Promise<FiscalInfo>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(['fiscal-settings'], data);
      void qc.invalidateQueries({ queryKey: ['invoicing-status'] });
    },
  });
}

export const useSaveFiscalSettings = () =>
  useSettingsMutation((input: FiscalSettingsInput) => api<FiscalInfo>('/invoicing/settings', { method: 'PUT', body: JSON.stringify(input) }));

export const useGenerateCsr = () => useSettingsMutation(() => api<FiscalInfo>('/invoicing/settings/csr', { method: 'POST' }));

export const useSaveCertificate = () =>
  useSettingsMutation((certificate: string) => api<FiscalInfo>('/invoicing/settings/certificate', { method: 'PUT', body: JSON.stringify({ certificate }) }));

export const useTestArca = () => useMutation({ mutationFn: () => api<ArcaTestResult>('/invoicing/settings/test', { method: 'POST' }) });

export const useInvoices = (q: string) =>
  useQuery({
    queryKey: ['invoices', q],
    queryFn: () => api<InvoiceRow[]>(`/invoicing/invoices?q=${encodeURIComponent(q)}`),
    placeholderData: (prev) => prev,
  });

export const useOrderInvoices = (orderId: string) =>
  useQuery({ queryKey: ['invoices', 'order', orderId], queryFn: () => api<InvoiceRow[]>(`/invoicing/orders/${orderId}`) });

function useInvoiceMutation<I>(fn: (input: I) => Promise<InvoiceRow>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['fiscal-settings'] });
    },
  });
}

export const useIssueInvoice = (orderId: string) => useInvoiceMutation(() => api<InvoiceRow>(`/invoicing/orders/${orderId}`, { method: 'POST' }));

export const useCreditNote = () =>
  useInvoiceMutation(({ id, reason }: { id: string; reason: string }) =>
    api<InvoiceRow>(`/invoicing/invoices/${id}/credit-note`, { method: 'POST', body: JSON.stringify({ reason }) }),
  );

export const invoicePdfPath = (id: string) => `/invoicing/invoices/${id}/pdf`;
export const invoiceFilename = (i: Pick<InvoiceRow, 'label' | 'number'>) => `${i.label.replace(/ /g, '-')}-${i.number}.pdf`;
