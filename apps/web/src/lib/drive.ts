'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface DriveStatus {
  configured: boolean;
  connections: { id: string; googleAccount: string; rootFolderIds: string[]; lastSyncAt: string | null; status: string }[];
  files: { syncStatus: string; _count: number }[];
  errors: { name: string; lastError: string | null }[];
}

export const useDriveStatus = () =>
  useQuery({ queryKey: ['drive'], queryFn: () => api<DriveStatus>('/integrations/google-drive/status'), refetchInterval: 30_000 });

function useDriveMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ['drive'] }) });
}

/** Pide a la API la URL de Google y lleva al usuario a dar el permiso. */
export const useConnectDrive = () =>
  useMutation({
    mutationFn: async (folders: string) => {
      const { url } = await api<{ url: string }>(`/integrations/google-drive/connect?folderIds=${encodeURIComponent(folders)}`);
      window.location.href = url;
    },
  });

export const useSyncDrive = () =>
  useDriveMutation((connectionId: string) => api<{ started: boolean }>('/integrations/google-drive/sync', { method: 'POST', body: JSON.stringify({ connectionId }) }));

export const useDisconnectDrive = () =>
  useDriveMutation((connectionId: string) => api('/integrations/google-drive/disconnect', { method: 'POST', body: JSON.stringify({ connectionId }) }));

export const folderLink = (id: string) => `https://drive.google.com/drive/folders/${id}`;
