'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecommendationListInput } from '@spiceos/contracts';
import { api } from './api';

export type Segment = RecommendationListInput['segment'];

export interface RecommendedItem {
  sku: string;
  product: string | null;
  presentation: string | null;
  active: boolean;
}

export interface RecommendationsView {
  segments: { segment: Segment; label: string; isDefault: boolean; updatedAt: string | null; items: RecommendedItem[] }[];
  combos: ComboView[];
  options: { sku: string; product: string; presentation: string }[];
}

/** Un combo: producto con SKU propio que al venderse descuenta stock de cada sobre. */
export interface ComboView {
  variantId: string;
  sku: string;
  code: string;
  name: string;
  presentation: string;
  items: { variantId: string; sku: string; product: string; presentation: string; quantity: number; active: boolean }[];
  /** Precio Minorista (null si no tiene). */
  price: number | null;
  looseTotal: number | null;
  firstPurchaseDiscountPct: number;
  available: boolean;
}

const KEY = ['catalog', 'recommendations'];

export const useRecommendations = () => useQuery({ queryKey: KEY, queryFn: () => api<RecommendationsView>('/catalog/recommendations') });

function useSetting<I>(fn: (input: I) => Promise<RecommendationsView>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (data) => qc.setQueryData(KEY, data) });
}

export const useSaveRecommendations = () =>
  useSetting((input: RecommendationListInput) => api<RecommendationsView>('/catalog/recommendations', { method: 'PUT', body: JSON.stringify(input) }));

export const useResetRecommendations = () =>
  useSetting((segment: Segment) => api<RecommendationsView>(`/catalog/recommendations/${segment}`, { method: 'DELETE' }));
