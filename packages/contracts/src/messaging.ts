import { z } from 'zod';

/** Datos de la cuenta de WhatsApp Cloud API que se cargan desde Configuración. */
export const whatsappAccountSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, 'El identificador del número son solo dígitos'),
  wabaId: z.string().trim().regex(/^\d{5,30}$/, 'El identificador de la cuenta son solo dígitos'),
  /** Vacío al editar = se mantiene el que ya estaba guardado. */
  accessToken: z.string().trim().max(1000).optional(),
  appSecret: z.string().trim().max(200).optional(),
  autoCreateCustomer: z.boolean().default(false),
  /** PIN de verificación en dos pasos: si viene, se registra el número en la Cloud API (alta inicial). */
  pin: z.string().trim().regex(/^\d{6}$/, 'El PIN son 6 dígitos').optional(),
});
export type WhatsappAccountInput = z.infer<typeof whatsappAccountSchema>;

/** Rubros que acepta Meta para el perfil de WhatsApp Business. */
export const WHATSAPP_VERTICALS = [
  'GROCERY', 'RESTAURANT', 'RETAIL', 'OTHER', 'PROF_SERVICES', 'EVENT_PLAN', 'HOTEL', 'EDU', 'HEALTH', 'BEAUTY', 'APPAREL', 'AUTO', 'ENTERTAIN',
  'FINANCE', 'GOVT', 'NONPROFIT', 'TRAVEL',
] as const;

const optionalUrl = z
  .string()
  .trim()
  .max(256)
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .refine((v) => !v || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v), 'La web tiene que ser una dirección, ej. www.tuweb.com.ar')
  .optional();

/**
 * Perfil público del número de WhatsApp (lo que ve el cliente al tocar el nombre).
 * Viaja como multipart (junto con la foto), por eso todos los campos son texto. Vacío = no se cambia en Meta.
 */
export const whatsappProfileSchema = z.object({
  about: z.string().trim().max(139, 'La info corta admite hasta 139 caracteres').optional(),
  description: z.string().trim().max(512, 'La descripción admite hasta 512 caracteres').optional(),
  address: z.string().trim().max(256, 'La dirección admite hasta 256 caracteres').optional(),
  email: z
    .string()
    .trim()
    .max(128)
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Email inválido')
    .optional(),
  website: optionalUrl,
  website2: optionalUrl,
  vertical: z.enum(WHATSAPP_VERTICALS).optional(),
});
export type WhatsappProfileInput = z.infer<typeof whatsappProfileSchema>;

export const conversationListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['OPEN', 'CLOSED', 'ALL']).default('OPEN'),
});
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>;

export const sendMessageSchema = z.object({ text: z.string().trim().min(1).max(4000) });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const updateConversationSchema = z.object({
  /** null desvincula. */
  customerId: z.string().uuid().nullable().optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
});
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

/** Asistente de ventas por WhatsApp (IA). */
export const assistantSettingsSchema = z.object({
  /** OFF: apagado. TEST: solo contesta a los teléfonos de prueba. ON: contesta a todos los clientes. */
  mode: z.enum(['OFF', 'TEST', 'ON']),
  testPhones: z
    .array(z.string().trim().regex(/^[\d\s+()-]{10,25}$/, 'Teléfono con característica, ej. 11 7058-0234'))
    .max(10)
    .default([]),
  minOrder: z.coerce.number().min(0).max(100_000_000),
  /** Lo que el asistente puede contar: días de entrega, formas de pago, horarios. */
  notes: z.string().trim().max(3000).nullable().optional(),
});
export type AssistantSettingsInput = z.infer<typeof assistantSettingsSchema>;

export const conversationAssistantSchema = z.object({ action: z.enum(['pause', 'resume']) });
export type ConversationAssistantInput = z.infer<typeof conversationAssistantSchema>;
