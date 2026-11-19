'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface InsightTotals {
  revenue: number;
  margin?: number;
  orders: number;
  customers: number;
  kg: number;
}

export interface Insights {
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  canSeeCost: boolean;
  totals: { current: InsightTotals; previous: InsightTotals };
  byMonth: { month: string; revenue: number; margin?: number; orders: number }[];
  products: { variant_id: string; sku: string; name: string; units: number; kg: number; revenue: number; margin?: number; orders: number; customers: number }[];
  staleProducts: { variant_id: string; sku: string; name: string; on_hand: number; stock_value?: number; last_sale: string | null }[];
  customers: { customer_id: string; name: string; orders: number; revenue: number; margin?: number; last_order: string }[];
  lapsedCustomers: {
    customerId: string;
    name: string;
    phone: string | null;
    orders: number;
    lastOrder: string;
    daysSinceLastOrder: number;
    usualEveryDays: number | null;
    avgTicket: number;
  }[];
}

export const useInsights = (from: string, to: string) =>
  useQuery({
    queryKey: ['analytics', 'insights', from, to],
    queryFn: () => api<Insights>(`/analytics/insights?from=${from}&to=${to}`),
  });
