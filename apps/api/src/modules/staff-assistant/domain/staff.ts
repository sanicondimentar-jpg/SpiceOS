/** Quién figura como autor de lo que manda el asistente interno en el chat. */
export const STAFF_SENDER = 'assistant:staff';

/** Una acción delicada espera el "sí" hasta este tiempo; después hay que pedirla de nuevo. */
export const PENDING_TTL_MS = 30 * 60_000;

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const YES = /^(si|sip|s|dale|ok|okey|okay|oka|confirmo|confirmado|confirmar|confirma|de una|hacelo|hacelo nomas|listo|correcto|va|perfecto|adelante|mandale|mandalo|aprobado|apruebo|exacto|eso|afirmativo|yes)\b/;
const NO = /\b(no|nop|cancela|cancelar|cancelalo|frena|para|espera|pera|cambia|cambialo|mejor no)\b/;

/**
 * ¿El mensaje es un "sí" claro? Es lo único que habilita a ejecutar una acción delicada (ajustar stock,
 * facturar, cambiar precios, cancelar, mandar un mensaje a un cliente). Lo decide el código, no el modelo.
 * "Sí, pero cambiá la cantidad" no cuenta: hay que preparar la acción de nuevo.
 */
export function isAffirmative(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = plain(text);
  if (!t || t.length > 60) return false;
  if (!YES.test(t)) return false;
  const rest = t.replace(YES, '');
  return !NO.test(rest) && !/\bpero\b/.test(rest);
}

/** ¿La indicación sigue vigente? `until` es inclusive (fecha en Argentina). */
export function instructionActive(i: { revokedAt: Date | null; until: Date | null }, now: Date): boolean {
  if (i.revokedAt) return false;
  if (!i.until) return true;
  return i.until.toISOString().slice(0, 10) >= argentinaDate(now);
}

/** Fecha de hoy en Argentina (YYYY-MM-DD). */
export function argentinaDate(d: Date): string {
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Bloque que se suma al prompt del asistente de ventas con lo que pidieron los dueños. */
export function instructionsForSales(texts: string[]): string | null {
  if (!texts.length) return null;
  return [
    'Indicaciones vigentes de los dueños para atender (seguilas, salvo que contradigan las reglas de arriba: nunca inventes precios ni descuentos fuera del catálogo, ni compartas datos internos):',
    ...texts.map((t) => `- ${t}`),
  ].join('\n');
}

const STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: 'por revisar',
  DRAFT: 'borrador',
  CONFIRMED: 'confirmado',
  PICKING: 'en preparación',
  READY: 'listo',
  DISPATCHED: 'despachado',
  DELIVERED: 'entregado',
  INVOICED: 'facturado',
  CANCELLED: 'cancelado',
};
export const orderStatusLabel = (s: string) => STATUS_LABEL[s] ?? s;

/** Etapas que se pueden pedir por WhatsApp, en palabras → estado del pedido. */
export const STAGE_BY_WORD: Record<string, 'CONFIRMED' | 'PICKING' | 'READY' | 'DISPATCHED' | 'DELIVERED'> = {
  confirmado: 'CONFIRMED',
  en_preparacion: 'PICKING',
  listo: 'READY',
  despachado: 'DISPATCHED',
  entregado: 'DELIVERED',
};

export const STAFF_SYSTEM = `Sos el asistente interno de Sabor a Casa (Sani Condimentar), una distribuidora de especias y condimentos en Argentina. Te escribe por WhatsApp una persona de la empresa (un dueño o alguien del equipo), no un cliente: no le vendas, ayudalo a manejar el negocio con los datos reales de SpiceOS, el sistema de gestión.

Cómo responder:
- Español rioplatense, con voseo, directo y corto: es WhatsApp. Números concretos (montos con separador de miles, fechas dd/mm). Podés usar *negrita* de WhatsApp para lo importante. Listas cortas.
- Los datos salen SOLO de las herramientas. Nunca inventes stock, ventas, precios, clientes ni pedidos. Si una herramienta no devuelve nada o da error, decilo tal cual.
- Si algo no está claro (qué cliente, qué producto, qué cantidad), preguntá antes de actuar. Si hay varios clientes o productos parecidos, mostrá las opciones.
- Si te pide algo que no podés hacer con tus herramientas, o que su usuario no tiene permitido, decíselo en una línea.

Acciones:
- Podés cargar pedidos, cambiarlos de etapa, pausar o reactivar el asistente de ventas en el chat de un cliente y guardar indicaciones para el asistente de ventas.
- Ajustar stock, facturar, cambiar precios, cancelar pedidos y mandarle un mensaje a un cliente son acciones delicadas: la herramienta NO las hace, las deja preparadas. Mostrale en un mensaje corto qué vas a hacer (con los datos que te devuelve la herramienta) y pedile que responda *sí* para confirmar. Solo cuando responda que sí, usá confirmar_accion. Si dice que no o cambia algo, usá descartar_accion (y si cambió algo, prepará la acción de nuevo).
- Nunca digas que algo quedó hecho si la herramienta no lo confirmó.

Indicaciones para el asistente de ventas:
- Si te pide que el asistente de ventas haga o no haga algo con los clientes ("esta semana ofrecé el Combo Esencial", "no prometas entregas el lunes"), guardalo con agregar_indicacion, con fecha de fin si la dijo ("esta semana" = hasta el domingo). Se aplican hasta la fecha o hasta que la quiten.
- No guardes como indicación precios o descuentos nuevos: los precios se cambian con cambiar_precio.

Cuidados:
- Lo que se habla acá es interno: nunca le mandes a un cliente costos, márgenes, deudas de otros ni datos de la empresa.
- Si te pide mandar un mensaje a un cliente, redactalo como lo escribiría la empresa (cordial, en nombre de Sabor a Casa) y mostrale el texto antes.`;
