// Catálogo de eventos de dominio publicados en el exchange `spiceos.events`.
// La routing key es el propio tipo (ej. "order.confirmed").

export interface EventEnvelope<T = unknown> {
  id: string;
  type: EventType;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  correlationId?: string;
  actor?: string;
  payload: T;
}

export const EVENT_TYPES = [
  'customer.created',
  'customer.updated',
  'customer.risk_changed',
  'customer.inactive_detected',
  'contact.created',
  'lead.created',
  'opportunity.created',
  'opportunity.stage_changed',
  'opportunity.won',
  'quote.created',
  'quote.approval_requested',
  'quote.approved',
  'quote.sent',
  'order.created',
  'order.confirmed',
  'order.dispatched',
  'order.delivered',
  'order.cancelled',
  'product.created',
  'product.updated',
  'product.cost_changed',
  'price_list.updated',
  'certification.expiring',
  'stock.below_minimum',
  'lot.expiring',
  'purchase_order.created',
  'purchase_order.received',
  'invoice.overdue',
  'payment.received',
  'message.received',
  'message.sent',
  'intent.detected',
  'document.version_created',
  'document.indexed',
  'knowledge.source_changed',
  'task.created',
  'rule.fired',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface ProductCostChangedPayload {
  productId: string;
  variantId: string;
  sku: string;
  previousCost: number;
  cost: number;
  changePct: number | null;
  source: string;
}

export interface PriceListUpdatedPayload {
  priceListId: string;
  variantIds: string[];
  reason: 'manual' | 'reprice' | 'import';
}

export interface MessageReceivedPayload {
  conversationId: string;
  messageId: string;
  customerId: string | null;
  leadId: string | null;
  type: string;
  text: string | null;
}

export interface IntentDetectedPayload extends MessageReceivedPayload {
  intent: 'purchase_intent' | 'price_request' | 'complaint' | 'payment_promise' | 'other';
  score: number;
  summary: string;
}

export interface QuoteCreatedPayload {
  quoteId: string;
  customerId: string;
  total: number;
  currency: string;
  requiresApproval: boolean;
}
