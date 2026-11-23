import { z } from 'zod';
import type { WebOrderTrackingStep } from './schemas';
import type { ChargeStatus } from './collections';

/**
 * Portal de clientes mayoristas (www.saboracasa.com.ar/mayoristas).
 * Se entra sin contraseña: el portal muestra un código y el cliente lo manda por WhatsApp desde
 * el teléfono de su ficha. La clave de la sesión viaja en el encabezado `x-portal-token`.
 */
export const PORTAL_TOKEN_HEADER = 'x-portal-token';

/** Pedido mínimo para mayoristas (zona GBA Norte y alrededores). */
export const PORTAL_MIN_ORDER = 50_000;

export interface PortalLoginStart {
  /** Identifica el pedido de ingreso para consultar si ya llegó el código. */
  requestId: string;
  /** Clave que guarda el navegador: cuando el código llega por WhatsApp pasa a ser la sesión. */
  token: string;
  code: string;
  /** Mensaje listo para mandar por WhatsApp (incluye el código). */
  message: string;
  whatsappUrl: string;
  expiresAt: string;
}

export const portalLoginStatusSchema = z.object({ requestId: z.string().uuid() });
export type PortalLoginStatusInput = z.infer<typeof portalLoginStatusSchema>;

export interface PortalLoginStatus {
  /** ok: ya puede entrar; not_customer: el número que escribió no es de un cliente. */
  status: 'pending' | 'ok' | 'not_customer' | 'expired';
  customerName?: string;
}

export interface PortalMe {
  customer: {
    code: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    deliveryDays: string[];
    deliveryHours: string | null;
  };
  priceList: string | null;
  minOrder: number;
  account: { balance: number; overdue: number; dueSoon: number; oldestDueDate: string | null; termsDays: number };
  /** Si tiene deuda vencida: puede pedir, pero el pedido no se entrega hasta regularizar. */
  overdueWarning: string | null;
}

/** Precio por unidad de venta de cada SKU para este cliente (su lista; si no, la Mayorista). */
export interface PortalPrices {
  items: { sku: string; price: number }[];
  updatedAt: string | null;
}

export interface PortalOrder {
  id: string;
  number: string;
  step: WebOrderTrackingStep;
  label: string;
  detail: string;
  createdAt: string;
  deliveredAt: string | null;
  total: number;
  withInvoice: boolean;
  lines: { sku: string; description: string; quantity: number; unitPrice: number; lineTotal: number }[];
  invoices: { id: string; label: string; date: string; total: number }[];
}

export const portalOrderSchema = z
  .object({
    lines: z
      .array(z.object({ sku: z.string().trim().min(1).max(40), quantity: z.number().int().positive().max(10_000) }))
      .max(200)
      .default([]),
    notes: z.string().trim().max(1000).optional(),
    /** Total que vio el cliente en el portal, para comparar al revisar. */
    total: z.number().nonnegative().optional(),
  })
  .refine((o) => o.lines.length > 0, { message: 'El pedido no tiene productos', path: ['lines'] });
export type PortalOrderInput = z.infer<typeof portalOrderSchema>;

export interface PortalOrderCreated {
  number: string;
  total: number;
  overdueWarning: string | null;
}

export interface PortalAccount {
  balance: number;
  overdue: number;
  dueSoon: number;
  credit: number;
  termsDays: number;
  charges: {
    date: string;
    dueDate: string;
    description: string;
    total: number;
    paid: number;
    balance: number;
    status: ChargeStatus;
    daysOverdue: number | null;
    invoiceId: string | null;
  }[];
  payments: { date: string; method: string; amount: number; reference: string | null }[];
}

/** Para la ficha del cliente en SpiceOS: quién entró al portal y desde cuándo. */
export interface PortalCustomerAccess {
  sessions: { id: string; phone: string; createdAt: string; lastSeenAt: string }[];
  portalUrl: string;
}
