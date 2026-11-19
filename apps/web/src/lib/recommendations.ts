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
  combo: { name: string; firstPurchaseDiscountPct: number; items: (RecommendedItem & { quantity: number })[] };
  combos: ComboView[];
  options: { sku: string; product: string; presentation: string }[];
}

/** Un combo con el precio de cada sobre dentro del combo (precio y unitPrice en null si falta algún sobre). */
export interface ComboView {
  code: string;
  name: string;
  fixedPrice: number | null;
  firstPurchaseDiscountPct: number;
  price: number | null;
  listTotal: number | null;
  items: (RecommendedItem & { variantId: string | null; quantity: number; unitPrice: number | null; listPrice: number | null })[];
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
