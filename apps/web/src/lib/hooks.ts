'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CopilotMessageInput } from '@spiceos/contracts';
import { api } from './api';

// Tipos de lectura (en fase 2 se generan desde el OpenAPI en packages/api-client).
export interface Me {
  user: { id: string; fullName: string; email: string };
  company: { id: string; tradeName: string | null; legalName: string };
  role: string;
  permissions: string[];
  branches: { id: string; code: string; name: string }[];
  unreadNotifications: number;
}

export interface ExecutiveKpis {
  revenue_mtd: number;
  revenue_prev_mtd: number;
  margin_mtd: number;
  orders_mtd: number;
  active_customers_90d: number;
  inactive_customers_60d: number;
  overdue_total: number;
  open_pipeline_weighted: number;
  stock_alerts: number;
  expiring_lots_30d: number;
}

export interface CustomerRow {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  status: string;
  industry: string | null;
  phone: string | null;
  lastOrderAt: string | null;
  riskScore: number | null;
}

export interface CopilotReply {
  sessionId: string;
  text: string;
  pendingConfirmations: { toolCallId: string; tool: string; input: Record<string, unknown> }[];
  toolsUsed: string[];
}

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), staleTime: 60_000 });

export const useExecutiveKpis = () =>
  useQuery({ queryKey: ['analytics', 'executive'], queryFn: () => api<ExecutiveKpis>('/analytics/executive') });

export const useRevenueByMonth = () =>
  useQuery({
    queryKey: ['analytics', 'revenue'],
    queryFn: () => api<{ month: string; revenue: number; margin: number }[]>('/analytics/revenue-by-month?months=12'),
  });

export const useCustomers = (q: string, page: number) =>
  useQuery({
    queryKey: ['customers', q, page],
    queryFn: () =>
      api<{ items: CustomerRow[]; total: number; page: number; pageSize: number }>(
        `/crm/customers?q=${encodeURIComponent(q)}&page=${page}&pageSize=25`,
      ),
    placeholderData: (prev) => prev,
  });

export const useCustomer360 = (id: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useQuery({ queryKey: ['customer360', id], queryFn: () => api<any>(`/crm/customers/${id}/360`) });

export const useCopilot = () =>
  useMutation({
    mutationFn: (input: CopilotMessageInput) => api<CopilotReply>('/copilot/chat', { method: 'POST', body: JSON.stringify(input) }),
  });

export const useConfirmToolCall = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<unknown>(`/copilot/tool-calls/${id}/confirm`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
  });
};
