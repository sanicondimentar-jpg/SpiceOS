'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContactInput, CreateCustomerInput, ImportResult } from '@spiceos/contracts';
import { api } from './api';

export interface Contact {
  id: string;
  fullName: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}

export const useCreateCustomer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerInput) =>
      api<{ id: string; code: string }>('/crm/customers', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
};

export const useContacts = (customerId: string) =>
  useQuery({ queryKey: ['contacts', customerId], queryFn: () => api<Contact[]>(`/crm/customers/${customerId}/contacts`) });

function useContactMutation<I>(customerId: string, fn: (input: I) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts', customerId] });
      qc.invalidateQueries({ queryKey: ['customer360', customerId] });
    },
  });
}

export const useAddContact = (customerId: string) =>
  useContactMutation(customerId, (input: ContactInput) =>
    api(`/crm/customers/${customerId}/contacts`, { method: 'POST', body: JSON.stringify(input) }),
  );

export const useMakePrimary = (customerId: string) =>
  useContactMutation(customerId, (contactId: string) =>
    api(`/crm/customers/${customerId}/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify({ isPrimary: true }) }),
  );

export const useRemoveContact = (customerId: string) =>
  useContactMutation(customerId, (contactId: string) => api(`/crm/customers/${customerId}/contacts/${contactId}`, { method: 'DELETE' }));

export type ImportKind = 'customers' | 'products' | 'stock';

export const useImport = (kind: ImportKind) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, dryRun, onDuplicate }: { file: File; dryRun: boolean; onDuplicate: 'skip' | 'update' }) => {
      const body = new FormData();
      body.append('file', file);
      return api<ImportResult>(`/imports/${kind}?dryRun=${dryRun}&onDuplicate=${onDuplicate}`, { method: 'POST', body });
    },
    onSuccess: (result) => {
      if (!result.dryRun) qc.invalidateQueries({ queryKey: [kind] });
    },
  });
};
