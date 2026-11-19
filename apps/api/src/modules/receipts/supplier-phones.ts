const digits = (s: string) => s.replace(/\D/g, '');

/** Normaliza un teléfono cargado a mano: solo dígitos; hacen falta al menos 10 (característica + número). */
export function normalizeReceiptPhone(phone: string): string | null {
  const d = digits(phone);
  return d.length >= 10 ? d : null;
}

/**
 * ¿El número de WhatsApp (E.164 sin "+", ej. 5491170580234) es uno de los autorizados?
 * Se comparan los últimos 10 dígitos: así da igual si se cargó con +54, con el 9 o sin ellos.
 */
export function isAuthorizedPhone(waContactId: string, authorized: string[]): boolean {
  const wa = digits(waContactId);
  return authorized.some((p) => {
    const n = normalizeReceiptPhone(p);
    return !!n && wa.endsWith(n.slice(-10));
  });
}
