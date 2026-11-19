import { z } from 'zod';

// Cobranza a clientes: deudas (pedidos entregados o cargadas a mano), cobros en efectivo o en cuenta
// con comprobante, qué deudas cubre cada cobro y avisos de vencimiento por WhatsApp.

export const CUSTOMER_PAYMENT_METHODS = ['CASH', 'TRANSFER', 'MERCADOPAGO', 'CHEQUE', 'ECHEQ', 'OTHER'] as const;
export type CustomerPaymentMethod = (typeof CUSTOMER_PAYMENT_METHODS)[number];
/** Medios "en cuenta": todo lo que no es efectivo. */
export const ACCOUNT_PAYMENT_METHODS = ['TRANSFER', 'MERCADOPAGO', 'CHEQUE', 'ECHEQ', 'OTHER'] as const;
export const CUSTOMER_PAYMENT_METHOD_LABEL: Record<CustomerPaymentMethod, string> = {
  CASH: 'Efectivo',
  TRANSFER: 'Transferencia',
  MERCADOPAGO: 'Mercado Pago',
  CHEQUE: 'Cheque',
  ECHEQ: 'E-cheq',
  OTHER: 'Otro',
};
export type PaymentBucket = 'CASH' | 'ACCOUNT';
export const PAYMENT_BUCKET_LABEL: Record<PaymentBucket, string> = { CASH: 'Dinero en efectivo', ACCOUNT: 'Dinero en cuenta' };
export const paymentBucket = (method: string): PaymentBucket => (method === 'CASH' ? 'CASH' : 'ACCOUNT');

const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());
const optMoney = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? 0 : v),
  z.coerce.number().min(0).max(1e12),
);
const ids = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v ?? []),
  z.array(z.string().uuid()).max(200),
);

/** Deuda cargada a mano: lo que debía de antes del sistema, ajustes. */
export const createCustomerChargeSchema = z.object({
  date: z.string().date(),
  dueDate: z.string().date().optional(),
  total: z.number().positive().max(1e12),
  description: optText(200),
});
export type CreateCustomerChargeInput = z.infer<typeof createCustomerChargeSchema>;

export const updateCustomerChargeSchema = z.object({
  dueDate: z.string().date().optional(),
  description: z.string().trim().max(200).nullable().optional(),
});
export type UpdateCustomerChargeInput = z.infer<typeof updateCustomerChargeSchema>;

/**
 * Cobro (multipart con el comprobante en "file"). Puede ser parte en efectivo y parte en cuenta:
 * se guardan como dos cobros del mismo grupo. Se imputa a las deudas elegidas de la más vieja a la
 * más nueva; lo que sobra queda a cuenta. `orderId`: cobrado para un pedido que todavía no se entregó.
 */
export const createCustomerPaymentSchema = z
  .object({
    date: z.string().date(),
    cashAmount: optMoney,
    accountAmount: optMoney,
    accountMethod: z.enum(ACCOUNT_PAYMENT_METHODS).default('TRANSFER'),
    reference: optText(120),
    notes: optText(500),
    collectedBy: optText(120),
    chargeIds: ids,
    orderId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  })
  .refine((v) => v.cashAmount + v.accountAmount > 0, { message: 'Poné cuánto se cobró en efectivo o en cuenta', path: ['cashAmount'] });
export type CreateCustomerPaymentInput = z.infer<typeof createCustomerPaymentSchema>;

export const collectionSettingsSchema = z.object({
  termsDays: z.number().int().min(0).max(365),
  remindersEnabled: z.boolean(),
  daysBefore: z.number().int().min(1).max(60),
  notifyPhone: z.string().trim().max(30).nullable(),
  ownerTemplate: z.string().trim().max(120).nullable(),
  customerTemplate: z.string().trim().max(120).nullable(),
  templateLang: z.string().trim().min(2).max(10),
});
export type CollectionSettingsInput = z.infer<typeof collectionSettingsSchema>;

export type ChargeStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED';

export interface CustomerChargeRow {
  id: string;
  date: string;
  dueDate: string;
  total: number;
  paid: number;
  balance: number;
  status: ChargeStatus;
  /** Días de atraso (positivo) o que faltan para vencer (negativo); null si no tiene saldo. */
  daysOverdue: number | null;
  source: 'ORDER' | 'MANUAL';
  description: string | null;
  order: { id: string; number: string; withInvoice: boolean; invoice: string | null } | null;
  notices: { kind: string; status: string; at: string; error: string | null }[];
}

export interface CustomerPaymentRow {
  id: string;
  groupId: string | null;
  date: string;
  method: CustomerPaymentMethod;
  bucket: PaymentBucket;
  amount: number;
  unallocated: number;
  reference: string | null;
  notes: string | null;
  collectedBy: string | null;
  hasProof: boolean;
  proofType: string | null;
  proofName: string | null;
  createdBy: string | null;
  createdAt: string;
  cancelled: boolean;
  order: { id: string; number: string } | null;
  allocations: { chargeId: string; date: string; label: string; amount: number }[];
}

export interface CustomerBalance {
  customerId: string;
  code: string;
  name: string;
  phone: string | null;
  /** Lo que debe (negativo: saldo a favor). */
  balance: number;
  overdue: number;
  /** Vence dentro de los días de aviso. */
  dueSoon: number;
  oldestDueDate: string | null;
  maxDaysOverdue: number;
  openCharges: number;
  lastPaymentAt: string | null;
}

export interface CustomerAccountStatement extends CustomerBalance {
  charged: number;
  paid: number;
  /** Cobros sin imputar a ninguna deuda. */
  credit: number;
  termsDays: number;
  charges: CustomerChargeRow[];
  payments: CustomerPaymentRow[];
}

export interface CollectionsSummary {
  from: string;
  to: string;
  collected: { cash: number; account: number; total: number };
  byDay: { date: string; cash: number; account: number }[];
  receivable: number;
  overdue: number;
  dueSoon: number;
  daysBefore: number;
  customers: CustomerBalance[];
  payments: (CustomerPaymentRow & { customerId: string; customer: string })[];
}

/** Deuda vencida de un cliente: se muestra al armar un pedido y frena la entrega hasta regularizar. */
export interface OverdueDebt {
  amount: number;
  oldestDueDate: string;
  maxDaysOverdue: number;
}
