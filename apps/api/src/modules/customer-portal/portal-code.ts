import { randomInt } from 'node:crypto';

/** Número de WhatsApp de la empresa (al que el cliente manda el código). */
export const BUSINESS_WHATSAPP = '5491170580234';

/** Cuánto dura el código para entrar al portal. */
export const LOGIN_CODE_TTL_MS = 15 * 60_000;

/** Cuánto dura la sesión del portal en el celular del cliente (se renueva con cada uso). */
export const SESSION_TTL_MS = 180 * 24 * 3600_000;

/** Código de 6 cifras (sin ceros adelante, para que no se pierdan al copiarlo). */
export const newLoginCode = () => String(randomInt(100_000, 1_000_000));

/** El mensaje que el portal deja listo para mandar por WhatsApp. */
export const loginMessage = (code: string) => `Código para entrar al portal de clientes de Sabor a Casa: ${code}`;

/**
 * El código que vino en un mensaje de WhatsApp, si el mensaje es para entrar al portal.
 * Pide la palabra "portal" para no confundirlo con otros números (un pedido, un teléfono).
 */
export function loginCodeIn(text: string | null | undefined): string | null {
  if (!text || !/\bportal\b/i.test(text)) return null;
  return text.match(/(?<!\d)(\d{6})(?!\d)/)?.[1] ?? null;
}
