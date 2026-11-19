import { z } from 'zod';

// Inventario: ingresos con lote y vencimiento, ajustes, apertura de cajas y consultas.

const qty = z.number().positive().max(1e9);

export const receiveLineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: qty,
  lotCode: z.string().trim().min(1).max(60).optional(), // sin lote: stock sin trazabilidad
  expiresAt: z.string().date().optional(),
  unitCost: z.number().nonnegative().max(1e12).optional(),
});

export const receiveStockSchema = z.object({
  warehouseId: z.string().uuid(),
  supplierId: z.string().uuid().optional(), // con proveedor, el ingreso queda como compra en su cuenta (Compras → Pagos)
  reference: z.string().max(120).optional(), // remito o factura del proveedor
  documentDate: z.string().date().optional(), // fecha del remito (la de la compra); si falta, hoy
  updateCost: z.boolean().default(false), // el costo del ingreso pasa a ser el costo vigente
  lines: z.array(receiveLineSchema).min(1).max(500),
});
export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;

export const adjustStockSchema = z
  .object({
    warehouseId: z.string().uuid(),
    variantId: z.string().uuid(),
    lotId: z.string().uuid().nullable().optional(),
    type: z.enum(['ADJUSTMENT', 'WASTE']).default('ADJUSTMENT'),
    // "delta": suma o resta; "count": la cantidad contada pasa a ser el saldo.
    mode: z.enum(['delta', 'count']).default('delta'),
    quantity: z.number().min(-1e9).max(1e9),
    reason: z.string().trim().min(3).max(300),
  })
  .refine((v) => v.mode === 'count' ? v.quantity >= 0 : v.quantity !== 0, { message: 'Cantidad inválida', path: ['quantity'] });
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

/** Abrir cajas: sale la caja y entran las unidades sueltas, con el mismo lote y vencimiento. */
export const breakPackSchema = z
  .object({
    warehouseId: z.string().uuid(),
    fromVariantId: z.string().uuid(),
    toVariantId: z.string().uuid(),
    packs: z.number().int().positive().max(10_000),
    unitsPerPack: z.number().int().positive().max(10_000),
  })
  .refine((v) => v.fromVariantId !== v.toVariantId, { message: 'Elegí presentaciones distintas', path: ['toVariantId'] });
export type BreakPackInput = z.infer<typeof breakPackSchema>;

export const stockQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  q: z.string().optional(),
  onlyLow: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
export type StockQuery = z.infer<typeof stockQuerySchema>;

export const movementsQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type MovementsQuery = z.infer<typeof movementsQuerySchema>;

// ---------------------------------------------------------------------------
// Remitos de compra leídos con IA (foto o PDF) e ingresos "por confirmar".
// ---------------------------------------------------------------------------

/** Renglón del remito ya cruzado con el catálogo: sale listo para el formulario de ingreso. */
export interface ReceiptReadingLine {
  variantId: string;
  sku: string;
  description: string; // producto y presentación del catálogo
  sourceText: string; // cómo figura en el remito
  quantity: number;
  unitCost: number | null; // precio del remito con el descuento aplicado
  currentCost: number | null;
}

/** Lectura de un remito: lo que la IA reconoce y lo que no pudo cruzar con el catálogo. */
export interface ReceiptReading {
  reference: string | null; // número de remito o, si no tiene, "Remito dd/mm/aaaa"
  documentDate: string | null; // aaaa-mm-dd
  supplierName: string | null;
  discountPct: number | null;
  total: number | null;
  lines: ReceiptReadingLine[];
  unmatched: { sourceText: string; quantity: number | null }[];
}

export type PendingReceiptSource = 'WHATSAPP' | 'API';
export type PendingReceiptStatus = 'PENDING' | 'CONFIRMED' | 'DISCARDED';

export interface PendingReceiptSummary {
  id: string;
  source: PendingReceiptSource;
  status: PendingReceiptStatus;
  supplier: { id: string; name: string } | null;
  sender: string | null; // teléfono de WhatsApp o nombre de la clave
  reference: string | null;
  documentDate: string | null;
  lines: number;
  unmatched: number;
  createdAt: string;
}

export interface PendingReceiptDetail extends PendingReceiptSummary {
  note: string | null;
  hasImage: boolean;
  reading: ReceiptReading;
}

/** Al confirmar se registra el ingreso con lo que el usuario revisó en el formulario. */
export const confirmPendingReceiptSchema = receiveStockSchema;
export type ConfirmPendingReceiptInput = z.infer<typeof confirmPendingReceiptSchema>;

/** Carga externa (Claude u otra integración con clave de acceso): foto o PDF y opcionalmente el proveedor. */
export const createPendingReceiptSchema = z.object({
  supplierCode: z.string().trim().min(1).max(30).optional(),
  note: z.string().trim().max(500).optional(),
});
export type CreatePendingReceiptInput = z.infer<typeof createPendingReceiptSchema>;

/** Claves de acceso para integraciones: hoy solo pueden dejar remitos por confirmar. */
export const createApiKeySchema = z.object({ name: z.string().trim().min(2).max(60) });
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
