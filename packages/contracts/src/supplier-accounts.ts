import { z } from 'zod';

// Cuenta corriente con proveedores: compras (lo que se debe), pagos con comprobante y qué compras cubre cada pago.

export const SUPPLIER_PAYMENT_METHODS = ['TRANSFER', 'CASH', 'MERCADOPAGO', 'ECHEQ', 'CHEQUE', 'OTHER'] as const;
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number];
export const SUPPLIER_PAYMENT_METHOD_LABEL: Record<SupplierPaymentMethod, string> = {
  TRANSFER: 'Transferencia',
  CASH: 'Efectivo',
  MERCADOPAGO: 'Mercado Pago',
  ECHEQ: 'E-cheq',
  CHEQUE: 'Cheque',
  OTHER: 'Otro',
};

const money = z.number().positive().max(1e12);
const optText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

/** Compra cargada a mano: mercadería que ya estaba en stock, fletes, etc. */
export const createSupplierPurchaseSchema = z.object({
  date: z.string().date(),
  reference: optText(120),
  total: money,
  notes: optText(500),
});
export type CreateSupplierPurchaseInput = z.infer<typeof createSupplierPurchaseSchema>;

export const updateSupplierPurchaseSchema = z.object({
  date: z.string().date().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  total: money.optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
export type UpdateSupplierPurchaseInput = z.infer<typeof updateSupplierPurchaseSchema>;

/**
 * Pago (llega como multipart con el comprobante en "file"): por eso los números y la lista vienen como texto.
 * Se imputa a las compras elegidas de la más vieja a la más nueva; lo que sobra queda a cuenta.
 */
export const createSupplierPaymentSchema = z.object({
  date: z.string().date(),
  method: z.enum(SUPPLIER_PAYMENT_METHODS),
  amount: z.coerce.number().positive().max(1e12),
  reference: optText(120),
  notes: optText(500),
  purchaseIds: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v ?? []),
    z.array(z.string().uuid()).max(200),
  ),
});
export type CreateSupplierPaymentInput = z.infer<typeof createSupplierPaymentSchema>;

export type SupplierPurchaseStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED';

export interface SupplierAccountSummary {
  supplierId: string;
  code: string;
  name: string;
  purchased: number;
  paid: number;
  /** Lo que se le debe (negativo: saldo a favor). */
  balance: number;
  unpaidPurchases: number;
  lastPaymentAt: string | null;
}

export interface SupplierPurchaseRow {
  id: string;
  date: string;
  reference: string | null;
  total: number;
  paid: number;
  balance: number;
  status: SupplierPurchaseStatus;
  source: 'RECEIPT' | 'MANUAL';
  notes: string | null;
  hasReceiptImage: boolean;
  pendingReceiptId: string | null;
}

export interface SupplierPaymentRow {
  id: string;
  date: string;
  method: SupplierPaymentMethod;
  amount: number;
  /** Lo que no cubrió ninguna compra. */
  unallocated: number;
  reference: string | null;
  notes: string | null;
  hasProof: boolean;
  proofType: string | null;
  proofName: string | null;
  createdBy: string | null;
  createdAt: string;
  cancelled: boolean;
  allocations: { purchaseId: string; date: string; reference: string | null; amount: number }[];
}

export interface SupplierAccountDetail extends SupplierAccountSummary {
  /** Pagos sin imputar a ninguna compra. */
  credit: number;
  purchases: SupplierPurchaseRow[];
  payments: SupplierPaymentRow[];
}
