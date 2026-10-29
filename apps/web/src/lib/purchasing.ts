'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateSupplierInput,
  PurchaseOrderTransitionInput,
  SupplierProductsInput,
  UpdatePurchaseOrderInput,
  UpdateSupplierInput,
} from '@spiceos/contracts';
import { api } from './api';

export type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviada',
  PARTIALLY_RECEIVED: 'Recibida en parte',
  RECEIVED: 'Recibida',
  CANCELLED: 'Cancelada',
};

export const PO_STATUS_TONE: Record<PurchaseOrderStatus, 'neutral' | 'brand' | 'warn' | 'good' | 'bad'> = {
  DRAFT: 'warn',
  SENT: 'brand',
  PARTIALLY_RECEIVED: 'brand',
  RECEIVED: 'good',
  CANCELLED: 'bad',
};

export interface PurchaseOrderRow {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplier: string;
  total: number;
  lines: number;
  createdAt: string;
  sentAt: string | null;
  expectedDate: string | null;
}

export interface PurchaseOrderDetail {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  statusLabel: string;
  nextStatuses: PurchaseOrderStatus[];
  version: number;
  supplier: { id: string; legalName: string; phone: string | null; email: string | null; taxId: string | null };
  notes: string | null;
  total: number;
  expectedDate: string | null;
  createdAt: string;
  sentAt: string | null;
  lines: {
    id: string;
    variantId: string;
    sku: string;
    description: string;
    quantity: number;
    receivedQty: number;
    unitCost: number;
    lineTotal: number;
    orders: { id: string; number: string; status: string; sku: string; missing: number }[];
  }[];
}

export interface Supplier {
  id: string;
  code: string;
  legalName: string;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  leadTimeDays: number;
  isActive: boolean;
  products: number;
}

export const usePurchaseOrders = (status?: PurchaseOrderStatus) =>
  useQuery({
    queryKey: ['purchase-orders', { status }],
    queryFn: () => api<PurchaseOrderRow[]>(`/purchase-orders${status ? `?status=${status}` : ''}`),
    placeholderData: (prev) => prev,
  });

export const usePurchaseOrder = (id: string) =>
  useQuery({ queryKey: ['purchase-orders', id], queryFn: () => api<PurchaseOrderDetail>(`/purchase-orders/${id}`) });

export const useSuppliers = () => useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers') });

function useInvalidating<I, O>(fn: (input: I) => Promise<O>, keys: string[][]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => keys.forEach((queryKey) => qc.invalidateQueries({ queryKey })) });
}

export const useUpdatePurchaseOrder = (id: string) =>
  useInvalidating(
    (input: UpdatePurchaseOrderInput) => api<{ version: number }>(`/purchase-orders/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    [['purchase-orders']],
  );

export const usePurchaseOrderTransition = (id: string) =>
  useInvalidating(
    (input: PurchaseOrderTransitionInput) => api<{ status: string }>(`/purchase-orders/${id}/status`, { method: 'POST', body: JSON.stringify(input) }),
    [['purchase-orders']],
  );

export const useCreateSupplier = () =>
  useInvalidating((input: CreateSupplierInput) => api<{ id: string }>('/suppliers', { method: 'POST', body: JSON.stringify(input) }), [['suppliers']]);

export const useUpdateSupplier = (id: string) =>
  useInvalidating((input: UpdateSupplierInput) => api<{ id: string }>(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(input) }), [['suppliers']]);

export const useSupplierProducts = (id: string) =>
  useInvalidating(
    (input: SupplierProductsInput) => api<{ count: number }>(`/suppliers/${id}/products`, { method: 'POST', body: JSON.stringify(input) }),
    [['suppliers']],
  );

/** Texto de la nota de pedido para mandar al proveedor por WhatsApp o mail. */
export function purchaseOrderText(po: PurchaseOrderDetail, company: string) {
  return [
    `Nota de pedido ${po.number} — ${company}`,
    `Proveedor: ${po.supplier.legalName}`,
    '',
    ...po.lines.map((l) => `• ${l.quantity} × [${l.sku}] ${l.description}`),
    ...(po.notes ? ['', po.notes] : []),
  ].join('\n');
}
