import { z } from 'zod';

/** CUIT con o sin guiones; se guarda solo con dígitos y se valida el dígito verificador. */
export const cuitSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => isValidCuit(v), 'El CUIT no es válido (revisá los 11 dígitos)');

export function isValidCuit(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(cuit[i]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === Number(cuit[10]);
}

export const FISCAL_CONDITIONS = ['MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO'] as const;

export const fiscalSettingsSchema = z.object({
  taxCondition: z.enum(FISCAL_CONDITIONS),
  cuit: cuitSchema,
  legalName: z.string().trim().min(2).max(200),
  address: z.string().trim().min(3).max(300),
  grossIncomeId: z.string().trim().max(50).optional().nullable(),
  activityStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  pointOfSale: z.coerce.number().int().min(1).max(99998).optional().nullable(),
  environment: z.enum(['TESTING', 'PRODUCTION']),
  monotributoCategory: z.string().trim().max(2).optional().nullable(),
  annualCap: z.coerce.number().min(0).optional().nullable(),
});
export type FiscalSettingsInput = z.infer<typeof fiscalSettingsSchema>;

/** Certificado (.crt) que devuelve ARCA para el pedido generado en SpiceOS. */
export const arcaCertificateSchema = z.object({ certificate: z.string().trim().min(100).max(20_000) });
export type ArcaCertificateInput = z.infer<typeof arcaCertificateSchema>;

export const creditNoteSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export type CreditNoteInput = z.infer<typeof creditNoteSchema>;

export const invoiceListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;
