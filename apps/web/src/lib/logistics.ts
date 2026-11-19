'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateRouteInput, UpdateRouteInput } from '@spiceos/contracts';
import { api } from './api';
import type { OrderStatus } from './orders';

export interface DeliveryOrder {
  id: string;
  number: string;
  status: OrderStatus;
  requestedDate: string | null;
  notes: string | null;
  grandTotal: number;
  customer: { id: string; name: string; phone: string | null; deliveryDays: string[]; deliveryHours: string | null };
  address: { street: string; city: string; province: string; note: string | null } | null;
  zone: string;
  mapsUrl: string | null;
}

export interface PendingDelivery extends DeliveryOrder {
  lastFailure: string | null;
}

export type RouteStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE';
export type StopStatus = 'SCHEDULED' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED';

export const ROUTE_STATUS_LABEL: Record<RouteStatus, string> = { PLANNED: 'Armada', IN_PROGRESS: 'En reparto', DONE: 'Terminada' };
export const ROUTE_STATUS_TONE: Record<RouteStatus, 'neutral' | 'brand' | 'good'> = { PLANNED: 'neutral', IN_PROGRESS: 'brand', DONE: 'good' };
export const STOP_STATUS_LABEL: Record<StopStatus, string> = { SCHEDULED: 'Por salir', IN_TRANSIT: 'En camino', DELIVERED: 'Entregado', FAILED: 'No se entregó' };
export const STOP_STATUS_TONE: Record<StopStatus, 'neutral' | 'brand' | 'good' | 'bad'> = { SCHEDULED: 'neutral', IN_TRANSIT: 'brand', DELIVERED: 'good', FAILED: 'bad' };

export interface RouteRow {
  id: string;
  date: string;
  driverName: string | null;
  status: RouteStatus;
  stops: number;
  delivered: number;
  failed: number;
}

export interface RouteDetail {
  id: string;
  date: string;
  driverName: string | null;
  status: RouteStatus;
  stops: { deliveryId: string; position: number; status: StopStatus; deliveredAt: string | null; notes: string | null; order: DeliveryOrder }[];
}

export const DAY_LABEL: Record<string, string> = { LUN: 'lun', MAR: 'mar', MIE: 'mié', JUE: 'jue', VIE: 'vie', SAB: 'sáb', DOM: 'dom' };

export const usePendingDeliveries = () => useQuery({ queryKey: ['logistics', 'pending'], queryFn: () => api<PendingDelivery[]>('/logistics/pending') });
export const useRoutes = () => useQuery({ queryKey: ['logistics', 'routes'], queryFn: () => api<RouteRow[]>('/logistics/routes') });
export const useRoute = (id: string) => useQuery({ queryKey: ['logistics', 'routes', id], queryFn: () => api<RouteDetail>(`/logistics/routes/${id}`) });

function useLogisticsMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['logistics'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined && { body: JSON.stringify(body) }) });

export const useCreateRoute = () => useLogisticsMutation((input: CreateRouteInput) => api<{ id: string }>('/logistics/routes', json('POST', input)));
export const useUpdateRoute = (id: string) => useLogisticsMutation((input: UpdateRouteInput) => api<{ id: string }>(`/logistics/routes/${id}`, json('PATCH', input)));
export const useDeleteRoute = (id: string) => useLogisticsMutation(() => api<{ id: string }>(`/logistics/routes/${id}`, json('DELETE')));
export const useStartRoute = (id: string) => useLogisticsMutation(() => api<{ id: string }>(`/logistics/routes/${id}/start`, json('POST')));
export const useStopDelivered = () => useLogisticsMutation((deliveryId: string) => api<{ deliveryId: string }>(`/logistics/stops/${deliveryId}/delivered`, json('POST')));
export const useStopFailed = () =>
  useLogisticsMutation(({ deliveryId, reason }: { deliveryId: string; reason: string }) => api<{ deliveryId: string }>(`/logistics/stops/${deliveryId}/failed`, json('POST', { reason })));
