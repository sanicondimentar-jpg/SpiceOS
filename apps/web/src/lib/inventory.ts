'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdjustStockInput, BreakPackInput, ReceiveStockInput } from '@spiceos/contracts';
import { api } from './api';

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  branchId: string;
}

export interface StockRow {
  variantId: string;
  sku: string;
  name: string;
  onHand: number;
  reserved: number;
  available: number;
  nextExpiry: string | null;
  reorderPoint: number;
  low: boolean;
  value?: number; // solo con permiso de costos
}

export interface VariantStock {
  variantId: string;
  sku: string;
  name: string;
  lots: {
    stockItemId: string;
    warehouseId: string;
    warehouse: string;
    lotId: string | null;
    lot: string | null;
    expiresAt: string | null;
    qualityStatus: string | null;
    onHand: number;
    reserved: number;
  }[];
}

export interface Movement {
  id: string;
  occurredAt: string;
  type: string;
  warehouse: string;
  sku?: string;
  name: string;
  lot: string | null;
  quantity: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
}

export const MOVEMENT_LABEL: Record<string, string> = {
  PURCHASE_RECEIPT: 'Ingreso',
  SALE_DISPATCH: 'Despacho',
  TRANSFER_IN: 'Transferencia (entra)',
  TRANSFER_OUT: 'Transferencia (sale)',
  ADJUSTMENT: 'Ajuste',
  RETURN_IN: 'Devolución',
  PRODUCTION_IN: 'Apertura (entra)',
  PRODUCTION_OUT: 'Apertura (sale)',
  WASTE: 'Merma',
};

export const useWarehouses = () =>
  useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/inventory/warehouses'), staleTime: 5 * 60_000 });

export const useStock = (params: { warehouseId?: string; q: string; onlyLow: boolean }) =>
  useQuery({
    queryKey: ['stock', params],
    queryFn: () => {
      const qs = new URLSearchParams({ q: params.q, onlyLow: String(params.onlyLow) });
      if (params.warehouseId) qs.set('warehouseId', params.warehouseId);
      return api<StockRow[]>(`/inventory/stock?${qs}`);
    },
    placeholderData: (prev) => prev,
  });

export const useVariantStock = (variantId: string | undefined) =>
  useQuery({ queryKey: ['stock', 'variant', variantId], queryFn: () => api<VariantStock>(`/inventory/stock/${variantId}`), enabled: !!variantId });

export const useMovements = (params: { variantId?: string; limit?: number }) =>
  useQuery({
    queryKey: ['movements', params],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: String(params.limit ?? 100) });
      if (params.variantId) qs.set('variantId', params.variantId);
      return api<Movement[]>(`/inventory/movements?${qs}`);
    },
  });

function useStockMutation<I, O>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: I) => api<O>(path, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['movements'] });
    },
  });
}

export const useReceiveStock = () => useStockMutation<ReceiveStockInput, { received: number }>('/inventory/receipts');
export const useAdjustStock = () => useStockMutation<AdjustStockInput, { delta: number; onHand: number }>('/inventory/adjustments');
export const useBreakPack = () => useStockMutation<BreakPackInput, { packs: number; units: number; lots: number }>('/inventory/break-pack');
