import { z } from 'zod';

// Catálogo: productos, presentaciones, costos, listas de precios y certificaciones.

const money = z.number().nonnegative().max(1e12);
const pct = z.number().min(0).max(100);

export const variantSchema = z.object({
  sku: z.string().min(2).max(40),
  name: z.string().min(1).max(80), // "1 kg", "Bolsa 25 kg"
  gtin: z.string().regex(/^\d{8,14}$/, 'GTIN/EAN inválido').optional(),
  unit: z.enum(['UN', 'KG']).default('UN'),
  netWeightKg: z.number().positive().max(10_000),
  cost: money.default(0),
  minMarginPct: pct.default(0),
  minStock: z.number().nonnegative().default(0),
  reorderPoint: z.number().nonnegative().default(0),
});
export type VariantInput = z.infer<typeof variantSchema>;

export const updateVariantSchema = variantSchema.omit({ sku: true, cost: true }).partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

export const createProductSchema = z.object({
  code: z.string().min(2).max(30),
  name: z.string().min(2).max(120),
  categoryId: z.string().uuid().optional(),
  description: z.string().max(4000).optional(),
  origin: z.string().max(80).optional(),
  botanicalName: z.string().max(120).optional(),
  allergens: z.array(z.string().max(60)).default([]),
  rnpa: z.string().max(40).optional(),
  shelfLifeDays: z.number().int().positive().max(3650).optional(),
  storageNotes: z.string().max(500).optional(),
  variants: z.array(variantSchema).min(1),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.omit({ code: true, variants: true }).partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productListQuerySchema = z.object({
  q: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  includeInactive: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const updateCostSchema = z.object({
  cost: money,
  source: z.enum(['manual', 'purchase', 'import']).default('manual'),
});
export type UpdateCostInput = z.infer<typeof updateCostSchema>;

export const categorySchema = z.object({
  name: z.string().min(2).max(80),
  parentId: z.string().uuid().optional(),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const priceListSchema = z.object({
  name: z.string().min(2).max(60),
  includesTax: z.boolean().default(false),
  validFrom: z.string().date().optional(),
  validTo: z.string().date().optional(),
  isDefault: z.boolean().default(false),
});
export type PriceListInput = z.infer<typeof priceListSchema>;

export const priceItemsSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        price: money,
        minQuantity: z.number().positive().default(1),
      }),
    )
    .min(1)
    .max(2000),
});
export type PriceItemsInput = z.infer<typeof priceItemsSchema>;

/** Recalcula precios de una lista como costo × factor, redondeado. */
export const repriceSchema = z.object({
  factor: z.number().min(1).max(20), // 1.55 = costo + 55 %
  roundTo: z.number().positive().default(10), // múltiplo al que se redondea hacia arriba
  variantIds: z.array(z.string().uuid()).optional(), // vacío = toda la lista
  dryRun: z.boolean().default(true),
});
export type RepriceInput = z.infer<typeof repriceSchema>;

export const certificationSchema = z.object({
  name: z.string().min(2).max(80), // Sin TACC, Kosher, Orgánico
  issuer: z.string().max(120).optional(),
});
export type CertificationInput = z.infer<typeof certificationSchema>;

export const productCertificationSchema = z.object({
  certificationId: z.string().uuid(),
  certificateNo: z.string().max(60).optional(),
  validUntil: z.string().date().optional(),
  documentId: z.string().uuid().optional(),
});
export type ProductCertificationInput = z.infer<typeof productCertificationSchema>;
