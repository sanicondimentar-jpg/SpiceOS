'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateConversationInput, WhatsappAccountInput } from '@spiceos/contracts';
import { api } from './api';
import type { OrderStatus } from './orders';

export interface ConversationRow {
  id: string;
  phone: string;
  contactName: string | null;
  customer: { id: string; name: string } | null;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  windowOpen: boolean;
  lastMessage: { text: string | null; type: string; direction: 'INBOUND' | 'OUTBOUND' } | null;
}

export interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  text: string | null;
  transcript: string | null;
  hasMedia: boolean;
  status: string;
  error: string | null;
  intent: string | null;
  sentAt: string;
  sentBy: string | null;
}

export interface ConversationDetail {
  id: string;
  phone: string;
  contactName: string | null;
  status: string;
  leadId: string | null;
  windowExpiresAt: string | null;
  windowOpen: boolean;
  customer: { id: string; code: string; name: string; status: string } | null;
  orders: { id: string; number: string; status: OrderStatus; total: number; createdAt: string }[];
  messages: ChatMessage[];
}

export interface WhatsappAccountInfo {
  webhookUrl: string;
  subscribeError?: string | null;
  account: {
    phoneNumberId: string;
    wabaId: string;
    displayPhone: string;
    verifiedName: string | null;
    autoCreateCustomer: boolean;
    hasAppSecret: boolean;
    verifyToken: string | null;
    connectedAt: string | null;
  } | null;
}

export const TYPE_LABEL: Record<string, string> = {
  audio: 'Audio',
  image: 'Foto',
  video: 'Video',
  document: 'Documento',
  sticker: 'Sticker',
  location: 'Ubicación',
  contacts: 'Contacto',
  reaction: 'Reacción',
  template: 'Plantilla',
};

/** Los chats se actualizan solos cada pocos segundos (Meta avisa al servidor, no al navegador). */
export const useConversations = (q: string, status: 'OPEN' | 'CLOSED' | 'ALL') =>
  useQuery({
    queryKey: ['conversations', q, status],
    queryFn: () => api<{ items: ConversationRow[]; unread: number }>(`/messaging/conversations?status=${status}&q=${encodeURIComponent(q)}`),
    refetchInterval: 10_000,
    placeholderData: (prev) => prev,
  });

export const useUnreadChats = (enabled: boolean) =>
  useQuery({
    queryKey: ['conversations', 'unread'],
    queryFn: () => api<{ unread: number }>('/messaging/conversations/unread'),
    refetchInterval: 30_000,
    enabled,
  });

export const useConversation = (id: string | null) =>
  useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api<ConversationDetail>(`/messaging/conversations/${id}`),
    enabled: !!id,
    refetchInterval: 5_000,
  });

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['conversations'] });
    void qc.invalidateQueries({ queryKey: ['conversation'] });
  };
}

export const useSendMessage = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (text: string) => api<{ id: string }>(`/messaging/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
    onSuccess: invalidate,
  });
};

export const useMarkRead = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<unknown>(`/messaging/conversations/${id}/read`, { method: 'POST' }),
    onSuccess: invalidate,
  });
};

export const useUpdateConversation = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: UpdateConversationInput) => api<unknown>(`/messaging/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: invalidate,
  });
};

export const useCreateCustomerFromChat = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api<{ id: string }>(`/messaging/conversations/${id}/customer`, { method: 'POST' }),
    onSuccess: invalidate,
  });
};

export const useWhatsappAccount = () =>
  useQuery({ queryKey: ['whatsapp-account'], queryFn: () => api<WhatsappAccountInfo>('/messaging/whatsapp-account') });

export const useSaveWhatsappAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WhatsappAccountInput) => api<WhatsappAccountInfo>('/messaging/whatsapp-account', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (data) => qc.setQueryData(['whatsapp-account'], data),
  });
};
