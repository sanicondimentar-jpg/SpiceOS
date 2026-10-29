'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateOrderInput, OrderPreviewInput, OrderTransitionInput, UpdateOrderInput } from '@spiceos/contracts';
import { api } from './api';

export type OrderStatus = 'PENDING_REVIEW' | 'DRAFT' | 'CONFIRMED' | 'PICKING' | 'READY' | 'DISPATCHED' | 'DELIVERED' | 'INVOICED' | 'CANCELLED';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_REVIEW: 'Por revisar',
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  PICKING: 'En preparación',
  READY: 'Listo',
  DISPATCHED: 'Despachado',
  DELIVERED: 'Entregado',
  INVOICED: 'Facturado',
  CANCELLED: 'Cancelado',
};

export const STATUS_TONE: Record<OrderStatus, 'neutral' | 'brand' | 'warn' | 'good' | 'bad'> = {
  PENDING_REVIEW: 'warn',
  DRAFT: 'neutral',
  CONFIRMED: 'brand',
  PICKING: 'warn',
  READY: 'warn',
  DISPATCHED: 'brand',
  DELIVERED: 'good',
  INVOICED: 'good',
  CANCELLED: 'bad',
};

export const CHANNEL_LABEL: Record<string, string> = { sales_rep: 'Vendedor', whatsapp: 'WhatsApp', portal: 'Portal', copilot: 'Copiloto', web: 'Web' };

export interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  customerId: string;
  customer: string;
  channel: string;
  total: number;
  withInvoice: boolean;
  taxTotal: number;
  grandTotal: number;
  lines: number;
  requestedDate: string | null;
  createdAt: string;
}

export interface OrderDetail {
  id: string;
  number: string;
  status: OrderStatus;
  statusLabel: string;
  nextStatuses: string[];
  version: number;
  channel: string;
  branchId: string;
  customer: { id: string; legalName: string; tradeName: string | null; taxId: string | null; phone: string | null };
  warehouse: { id: string; name: string };
  requestedDate: string | null;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  webTotal: number | null;
  createdCustomer: boolean;
  possibleDuplicates: { id: string; number: string; status: OrderStatus; total: number; createdAt: string }[];
  subtotal: number;
  discountTotal: number;
  total: number;
  withInvoice: boolean;
  taxTotal: number;
  grandTotal: number;
  marginTotal?: number;
  createdAt: string;
  confirmedAt: string | null;
  lines: {
    id: string;
    variantId: string;
    sku: string;
    description: string;
    quantity: number;
    deliveredQty: number;
    unitPrice: number;
    discountPct: number;
    lineTotal: number;
    unitCost?: number;
    available?: number;
    backorderQty: number;
    purchaseOrder: { id: string; number: string; status: string } | null;
    lots: { lot: string | null; expiresAt: string | null; quantity: number }[];
  }[];
  history: { from: OrderStatus | null; to: OrderStatus; at: string; by: string | null; reason: string | null }[];
}

export interface OrderPreview {
  lines: {
    variantId: string;
    sku: string;
    description: string;
    quantity: number;
    listPrice: number | null;
    unitPrice: number | null;
    discountPct: number;
    lineTotal: number | null;
    available: number;
    marginPct?: number | null;
  }[];
  subtotal: number;
  discountTotal: number;
  total: number;
  withInvoice: boolean;
  taxTotal: number;
  grandTotal: number;
  marginTotal?: number;
  warnings: string[];
}

export const useOrders = (params: { status?: OrderStatus; q: string; customerId?: string }, enabled = true) =>
  useQuery({
    queryKey: ['orders', params],
    enabled,
    queryFn: () => {
      const qs = new URLSearchParams({ q: params.q });
      if (params.status) qs.set('status', params.status);
      if (params.customerId) qs.set('customerId', params.customerId);
      return api<OrderRow[]>(`/orders?${qs}`);
    },
    placeholderData: (prev) => prev,
  });

export const useOrder = (id: string) => useQuery({ queryKey: ['orders', id], queryFn: () => api<OrderDetail>(`/orders/${id}`) });

export const useOrderPreview = () =>
  useMutation({ mutationFn: (input: OrderPreviewInput) => api<OrderPreview>('/orders/preview', { method: 'POST', body: JSON.stringify(input) }) });

function useOrderMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
  });
}

export const useCreateOrder = () =>
  useOrderMutation((input: CreateOrderInput) => api<{ id: string; number: string; total: number }>('/orders', { method: 'POST', body: JSON.stringify(input) }));

export const useUpdateOrder = (id: string) =>
  useOrderMutation((input: UpdateOrderInput) => api<{ id: string; version: number }>(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify(input) }));

/** Qué se hizo con lo que faltó al confirmar: nota de pedido al proveedor, cajas a abrir o sin proveedor. */
export interface Shortage {
  sku: string;
  description: string;
  missing: number;
  openPacks?: { sku: string; packs: number };
  purchase?: { purchaseOrderId: string; number: string; supplier: string; sku: string; quantity: number };
  noSupplier?: boolean;
}

export const useConfirmOrder = (id: string) =>
  useOrderMutation(() => api<{ status: string; shortages: Shortage[] }>(`/orders/${id}/confirm`, { method: 'POST' }));

export const useOrderTransition = (id: string) =>
  useOrderMutation((input: OrderTransitionInput) => api<{ status: string }>(`/orders/${id}/status`, { method: 'POST', body: JSON.stringify(input) }));
