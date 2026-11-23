'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface OpenTask {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueAt: string | null;
  createdAt: string;
  assigneeId: string | null;
  assigneeName: string | null;
}

export const useOpenTasks = () => useQuery({ queryKey: ['tasks', 'open'], queryFn: () => api<OpenTask[]>('/tasks') });

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; assigneeId: string | null }) =>
      api<{ id: string }>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/tasks/${id}/complete`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
