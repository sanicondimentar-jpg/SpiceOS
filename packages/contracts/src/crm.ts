import { z } from 'zod';

export const contactSchema = z.object({
  fullName: z.string().min(2).max(120),
  position: z.string().max(80).optional(), // Compras, Dueño, Chef
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  isPrimary: z.boolean().default(false),
});
export type ContactInput = z.infer<typeof contactSchema>;

export const updateContactSchema = contactSchema.partial();
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

/** Resultado de una importación desde planilla. */
export interface ImportRowError {
  row: number; // número de fila en la planilla (1 = encabezado)
  field?: string;
  message: string;
}

export interface ImportResult {
  dryRun: boolean;
  totalRows: number;
  valid: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
  preview: Record<string, unknown>[]; // primeras filas ya interpretadas
  unknownColumns: string[];
}

export const importOptionsSchema = z.object({
  dryRun: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  onDuplicate: z.enum(['skip', 'update']).default('skip'),
});
export type ImportOptions = z.infer<typeof importOptionsSchema>;
