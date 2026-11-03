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
