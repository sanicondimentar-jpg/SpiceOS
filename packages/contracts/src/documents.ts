import { z } from 'zod';

// Documentos del negocio: fichas técnicas, certificados, análisis, contratos, listas de proveedores.

export const DOCUMENT_KINDS = ['TECHNICAL_SHEET', 'CERTIFICATE', 'LAB_ANALYSIS', 'CATALOG', 'PRICE_LIST', 'MANUAL', 'CONTRACT', 'QUOTE_PDF', 'OTHER'] as const;
export type DocumentKindValue = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABEL: Record<DocumentKindValue, string> = {
  TECHNICAL_SHEET: 'Ficha técnica',
  CERTIFICATE: 'Certificado',
  LAB_ANALYSIS: 'Análisis de laboratorio',
  CATALOG: 'Catálogo',
  PRICE_LIST: 'Lista de precios de proveedor',
  MANUAL: 'Manual o procedimiento',
  CONTRACT: 'Contrato',
  QUOTE_PDF: 'Presupuesto',
  OTHER: 'Otro',
};

export const DOCUMENT_ENTITIES = ['product', 'supplier', 'customer'] as const;
export type DocumentEntity = (typeof DOCUMENT_ENTITIES)[number];

const empty = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optDay = z.preprocess(empty, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').optional());
const optUuid = z.preprocess(empty, z.string().uuid().optional());

/** Viaja como campos de un formulario multipart junto al archivo. */
export const createDocumentSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    kind: z.enum(DOCUMENT_KINDS),
    validUntil: optDay,
    entityType: z.preprocess(empty, z.enum(DOCUMENT_ENTITIES).optional()),
    entityId: optUuid,
    tags: z.preprocess(empty, z.string().trim().max(300).optional()),
  })
  .refine((v) => !v.entityType === !v.entityId, { message: 'Elegí a qué producto, proveedor o cliente corresponde', path: ['entityId'] });
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  entityType: z.enum(DOCUMENT_ENTITIES).nullable().optional(),
  entityId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export interface DocumentSummary {
  id: string;
  title: string;
  kind: DocumentKindValue;
  validUntil: string | null;
  entityType: DocumentEntity | null;
  entityId: string | null;
  entityName: string | null;
  tags: string[];
  source: 'UPLOAD' | 'DRIVE';
  current: { id: string; versionNo: number; fileName: string | null; mimeType: string; sizeBytes: number | null; createdAt: string; hasFile: boolean; searchable: boolean } | null;
  updatedAt: string;
}
