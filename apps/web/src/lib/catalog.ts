'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProductInput,
  PriceItemsInput,
  ProductCertificationInput,
  RepriceInput,
  UpdateCostInput,
  UpdateProductInput,
  VariantInput,
} from '@spiceos/contracts';
import { api } from './api';

export interface VariantRow {
  id: string;
  sku: string;
  gtin: string | null;
  name: string;
  unit: string;
  isActive: boolean;
  netWeightKg: number | null;
  minStock: number;
  reorderPoint: number;
  minMarginPct: number;
  currentCost?: number; // solo con permiso de costos
  listPrice?: number | null;
  marginPct?: number | null;
  prices?: { priceListId: string; priceList: string; minQuantity: number; price: number; marginPct?: number | null }[];
}

export interface ProductRow {
  id: string;
  code: string;
  name: string;
  origin: string | null;
  isActive: boolean;
  category: { id: string; name: string } | null;
  variants: VariantRow[];
}

export interface ProductDetail extends ProductRow {
  description: string | null;
  botanicalName: string | null;
  allergens: string[];
  rnpa: string | null;
  shelfLifeDays: number | null;
  storageNotes: string | null;
  certifications: { certificationId: string; certificateNo: string | null; validUntil: string | null; certification: { name: string; issuer: string | null } }[];
}

export interface PriceList {
  id: string;
  name: string;
  isDefault: boolean;
  includesTax: boolean;
  _count: { items: number; customers: number };
}

export interface PriceListItem {
  variantId: string;
  sku: string;
  name: string;
  minQuantity: number;
  price: number;
  cost?: number;
  marginPct?: number | null;
  belowMinMargin?: boolean;
}

export interface RepriceChange {
  variantId: string;
  sku: string;
  name: string;
  cost: number;
  currentPrice: number | null;
  newPrice: number;
  changePct: number | null;
  marginPct: number | null;
  belowMinMargin: boolean;
}

export const useProducts = (q: string, page: number) =>
  useQuery({
    queryKey: ['products', q, page],
    queryFn: () =>
      api<{ items: ProductRow[]; total: number; page: number; pageSize: number; priceList: { id: string; name: string } | null }>(
        `/catalog/products?q=${encodeURIComponent(q)}&page=${page}&pageSize=50`,
      ),
    placeholderData: (prev) => prev,
  });

export const useProduct = (id: string) =>
  useQuery({ queryKey: ['product', id], queryFn: () => api<ProductDetail>(`/catalog/products/${id}`) });

export const useCategories = () =>
  useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ id: string; name: string; _count: { products: number } }[]>('/catalog/categories'),
    staleTime: 60_000,
  });

export const useCertifications = () =>
  useQuery({
    queryKey: ['certifications'],
    queryFn: () => api<{ id: string; name: string; issuer: string | null }[]>('/catalog/certifications'),
    staleTime: 60_000,
  });

export const usePriceLists = () => useQuery({ queryKey: ['price-lists'], queryFn: () => api<PriceList[]>('/catalog/price-lists') });

export const usePriceListItems = (id: string | undefined) =>
  useQuery({
    queryKey: ['price-list', id],
    enabled: !!id,
    queryFn: () => api<PriceList & { items: PriceListItem[] }>(`/catalog/price-lists/${id}/items`),
  });

/** Mutación que invalida productos y listas: casi todo cambio de catálogo afecta precios y márgenes. */
function useCatalogMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['products', 'product', 'price-list', 'price-lists', 'categories', 'certifications']) qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const useCreateProduct = () =>
  useCatalogMutation((input: CreateProductInput) => api<{ id: string; code: string }>('/catalog/products', json('POST', input)));

export const useUpdateProduct = (id: string) =>
  useCatalogMutation((input: UpdateProductInput) => api(`/catalog/products/${id}`, json('PATCH', input)));

export const useAddVariant = (productId: string) =>
  useCatalogMutation((input: VariantInput) => api(`/catalog/products/${productId}/variants`, json('POST', input)));

export const useUpdateCost = () =>
  useCatalogMutation(({ variantId, ...input }: UpdateCostInput & { variantId: string }) => api(`/catalog/variants/${variantId}/cost`, json('PUT', input)));

export const useUpsertPrices = (priceListId: string) =>
  useCatalogMutation((input: PriceItemsInput) =>
    api<{ updated: number; warnings: string[] }>(`/catalog/price-lists/${priceListId}/items`, json('PUT', input)),
  );

export const useReprice = (priceListId: string) =>
  useCatalogMutation((input: RepriceInput) =>
    api<{ dryRun: boolean; changes: RepriceChange[] }>(`/catalog/price-lists/${priceListId}/reprice`, json('POST', input)),
  );

export const useAssignCertification = (productId: string) =>
  useCatalogMutation((input: ProductCertificationInput) => api(`/catalog/products/${productId}/certifications`, json('PUT', input)));

export const useCreateCertification = () =>
  useCatalogMutation((input: { name: string; issuer?: string }) => api<{ id: string }>('/catalog/certifications', json('POST', input)));
