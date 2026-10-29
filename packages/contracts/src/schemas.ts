import { z } from 'zod';

// Esquemas compartidos entre API (validación) y web (formularios).

export const createCustomerSchema = z.object({
  legalName: z.string().min(2).max(200),
  tradeName: z.string().max(200).optional(),
  taxId: z
    .string()
    .regex(/^\d{2}-?\d{8}-?\d$/, 'CUIT inválido')
    .optional(),
  taxCondition: z.enum(['RI', 'MONOTRIBUTO', 'CF', 'EXENTO']).optional(),
  industry: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  ownerId: z.string().uuid().optional(),
  priceListId: z.string().uuid().optional(),
  paymentTermsDays: z.number().int().min(0).max(180).default(0),
  creditLimit: z.number().nonnegative().optional(),
  source: z.string().max(50).optional(),
  tags: z.array(z.string()).default([]),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  version: z.number().int().positive(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const listQuerySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const quoteLineSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative().optional(), // si falta, se toma de la lista de precios
  discountPct: z.number().min(0).max(100).default(0),
});

export const createQuoteSchema = z.object({
  customerId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
  branchId: z.string().uuid(),
  validDays: z.number().int().min(1).max(90).default(15),
  notes: z.string().max(2000).optional(),
  lines: z.array(quoteLineSchema).min(1),
});
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

export const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  branchId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quoteId: z.string().uuid().optional(),
  channel: z.enum(['sales_rep', 'whatsapp', 'portal', 'copilot', 'web']).default('sales_rep'),
  /** Sin factura se vende al precio sin IVA y no se suma IVA. */
  withInvoice: z.boolean().default(true),
  requestedDate: z.string().date().optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(quoteLineSchema).min(1),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** Pedidos en borrador o pendientes de revisión: se reemplazan las líneas y se recalculan los precios. */
export const updateOrderSchema = createOrderSchema
  .pick({ customerId: true, warehouseId: true, withInvoice: true, requestedDate: true, notes: true, lines: true })
  .partial()
  .extend({ version: z.number().int().positive() });
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

/** Precios, margen y stock disponible de un pedido sin guardarlo. */
export const orderPreviewSchema = createOrderSchema.pick({ customerId: true, warehouseId: true, withInvoice: true, lines: true });
export type OrderPreviewInput = z.infer<typeof orderPreviewSchema>;

export const orderTransitionSchema = z.object({
  to: z.enum(['PICKING', 'READY', 'DISPATCHED', 'DELIVERED', 'CANCELLED']),
  reason: z.string().max(300).optional(),
});
export type OrderTransitionInput = z.infer<typeof orderTransitionSchema>;

export const orderListQuerySchema = z.object({
  status: z.enum(['PENDING_REVIEW', 'DRAFT', 'CONFIRMED', 'PICKING', 'READY', 'DISPATCHED', 'DELIVERED', 'INVOICED', 'CANCELLED']).optional(),
  customerId: z.string().uuid().optional(),
  q: z.string().optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

/**
 * Pedido hecho en la web pública (sin login). Queda pendiente de revisión: los precios
 * los pone SpiceOS según la lista del modo elegido, no los que manda el navegador.
 */
export const webOrderSchema = z.object({
  name: z.string().trim().min(2, 'Indicá tu nombre o comercio').max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .refine((v) => v.replace(/\D/g, '').length >= 8, 'Indicá un teléfono válido'),
  notes: z.string().trim().max(1000).optional(),
  /** Mayorista: cajas y granel; minorista: sobres sueltos (SKU con "-U"). */
  mode: z.enum(['mayorista', 'minorista']).default('mayorista'),
  lines: z
    .array(z.object({ sku: z.string().trim().min(1).max(40), quantity: z.number().int().positive().max(10_000) }))
    .min(1)
    .max(200),
  /** Total que vio la persona en la web, para comparar al revisar. */
  total: z.number().nonnegative().optional(),
  /** Campo oculto del formulario: si viene con algo, lo completó un robot. */
  website: z.string().max(200).optional(),
});
export type WebOrderInput = z.infer<typeof webOrderSchema>;

export const createSupplierSchema = z.object({
  code: z.string().trim().min(1).max(30),
  legalName: z.string().trim().min(2).max(200),
  taxId: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  leadTimeDays: z.number().int().min(0).max(365).default(7),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema.partial().extend({ isActive: z.boolean().optional() });
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

/** Asigna (o quita) presentaciones a un proveedor por SKU. */
export const supplierProductsSchema = z.object({
  skus: z.array(z.string().trim().min(1)).min(1).max(1000),
  preferred: z.boolean().default(true),
  remove: z.boolean().default(false),
});
export type SupplierProductsInput = z.infer<typeof supplierProductsSchema>;

export const purchaseOrderListQuerySchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional(),
  supplierId: z.string().uuid().optional(),
});
export type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListQuerySchema>;

/** Solo notas en borrador: cantidades y costos por línea (cantidad 0 quita la línea). */
export const updatePurchaseOrderSchema = z.object({
  version: z.number().int().positive(),
  notes: z.string().max(2000).optional(),
  expectedDate: z.string().date().nullable().optional(),
  lines: z
    .array(z.object({ variantId: z.string().uuid(), quantity: z.number().nonnegative(), unitCost: z.number().nonnegative().optional() }))
    .optional(),
});
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

export const purchaseOrderTransitionSchema = z.object({
  to: z.enum(['SENT', 'RECEIVED', 'CANCELLED']),
  reason: z.string().max(300).optional(),
});
export type PurchaseOrderTransitionInput = z.infer<typeof purchaseOrderTransitionSchema>;

export const copilotMessageSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(8000),
  agent: z
    .enum(['auto', 'commercial', 'pricing', 'purchasing', 'inventory', 'collections', 'executive', 'documents'])
    .default('auto'),
  context: z
    .object({ screen: z.string().optional(), entityType: z.string().optional(), entityId: z.string().optional() })
    .optional(),
});
export type CopilotMessageInput = z.infer<typeof copilotMessageSchema>;

const conditionLeaf = z.object({
  field: z.string(), // ruta en el payload del evento, ej. "payload.total"
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'in', 'exists']),
  value: z.unknown().optional(),
});
export type ConditionLeaf = z.infer<typeof conditionLeaf>;
export type ConditionNode = ConditionLeaf | { all: ConditionNode[] } | { any: ConditionNode[] } | { not: ConditionNode };
export const conditionSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    conditionLeaf,
    z.object({ all: z.array(conditionSchema) }),
    z.object({ any: z.array(conditionSchema) }),
    z.object({ not: conditionSchema }),
  ]),
);

export const ruleActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_task'),
    params: z.object({
      title: z.string(),
      assignTo: z.string().default('owner'), // owner | <userId>
      dueInHours: z.number().default(24),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
    }),
  }),
  z.object({
    type: z.literal('notify'),
    params: z.object({ role: z.string(), title: z.string(), body: z.string(), channel: z.string().default('IN_APP') }),
  }),
  z.object({
    type: z.literal('create_opportunity'),
    params: z.object({ title: z.string(), stage: z.string().default('Nueva') }),
  }),
  z.object({
    type: z.literal('run_agent'),
    params: z.object({ agent: z.string(), instruction: z.string() }),
  }),
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

export const automationRuleSchema = z.object({
  name: z.string().min(3),
  description: z.string().optional(),
  triggerType: z.enum(['EVENT', 'SCHEDULE']),
  eventType: z.string().optional(),
  schedule: z.string().optional(),
  conditions: conditionSchema,
  actions: z.array(ruleActionSchema).min(1),
  isActive: z.boolean().default(true),
});
export type AutomationRuleInput = z.infer<typeof automationRuleSchema>;
