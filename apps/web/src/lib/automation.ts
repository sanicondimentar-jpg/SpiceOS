'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlertSettingsInput } from '@spiceos/contracts';
import { api } from './api';

export type AlertKind = keyof AlertSettingsInput;

export interface Alert {
  kind: AlertKind;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  link: string;
}

export interface AlertsResponse {
  items: Alert[];
  counts: Record<AlertKind, number>;
  settings: AlertSettingsInput;
  allowed: Record<AlertKind, boolean>;
}

/** Qué revisa cada aviso y, si tiene umbral, qué significa. */
export const ALERT_INFO: Record<AlertKind, { title: string; description: string; param?: { label: (v: number) => string; unit: string; min: number; max: number } }> = {
  overdueDebt: { title: 'Deuda vencida', description: 'Clientes con saldos vencidos en Cobranza, primero los que más deben.' },
  lowStock: { title: 'Stock bajo', description: 'Productos con el disponible por debajo del mínimo o del punto de pedido de su ficha.' },
  expiring: {
    title: 'Productos por vencer',
    description: 'Lotes con stock que vencen pronto o ya vencieron.',
    param: { label: (v) => `Avisar ${v} días antes`, unit: 'días', min: 7, max: 365 },
  },
  webOrders: {
    title: 'Pedidos web sin revisar',
    description: 'Pedidos de la web o de WhatsApp que siguen "Por revisar".',
    param: { label: (v) => `Después de ${v} horas`, unit: 'horas', min: 1, max: 72 },
  },
  staleQuotes: {
    title: 'Presupuestos por vencer',
    description: 'Presupuestos enviados que vencen pronto y el cliente no respondió.',
    param: { label: (v) => `${v} días antes de vencer`, unit: 'días', min: 1, max: 30 },
  },
  lapsedCustomers: { title: 'Clientes que dejaron de comprar', description: 'Pasó bastante más de lo que suelen tardar entre pedido y pedido.' },
};

export const ALERT_ORDER: AlertKind[] = ['overdueDebt', 'lowStock', 'expiring', 'webOrders', 'staleQuotes', 'lapsedCustomers'];

/** Avisos del día. Se refrescan cada 5 minutos para la campanita. */
export const useAlerts = () =>
  useQuery({ queryKey: ['automation', 'alerts'], queryFn: () => api<AlertsResponse>('/automation/alerts'), refetchInterval: 5 * 60_000, staleTime: 60_000 });

export const useSaveAlertSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AlertSettingsInput) => api<AlertSettingsInput>('/automation/alert-settings', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['automation'] }),
  });
};
