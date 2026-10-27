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
  supplierId: z.string().uuid().optional(),
  reference: z.string().max(120).optional(), // remito o factura del proveedor
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
