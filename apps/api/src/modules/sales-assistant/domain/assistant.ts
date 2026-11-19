import { isAuthorizedPhone } from '../../receipts/supplier-phones';

/** OFF: no responde. TEST: solo a los teléfonos de prueba. ON: a todos los clientes (menos proveedores). */
export const ASSISTANT_MODES = ['OFF', 'TEST', 'ON'] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

/** Tope de respuestas del asistente por chat en 24 h: si se pasa, deriva a una persona (evita bucles con otros bots). */
export const MAX_REPLIES_PER_DAY = 40;

/** Cuánto se calla el asistente en un chat después de que responde una persona del equipo. */
export const HUMAN_PAUSE_HOURS = 12; // se aplica en ConversationsService.send

export interface DecisionInput {
  mode: AssistantMode;
  aiConfigured: boolean;
  phone: string;
  testPhones: string[];
  supplierPhones: string[];
  handoff: string | null;
  pausedUntil: Date | null;
  repliesLast24h: number;
  messageType: string;
  text: string | null;
  now: Date;
}

export type Decision = { answer: true } | { answer: false; reason: string };

/** Tipos de mensaje que no piden respuesta (una reacción, un sticker). */
const SILENT_TYPES = new Set(['reaction', 'sticker', 'unsupported', 'system', 'ephemeral']);

/** ¿Le contesta el asistente a este mensaje? Todas las reglas de prudencia están acá. */
export function decide(i: DecisionInput): Decision {
  if (i.mode === 'OFF') return { answer: false, reason: 'asistente apagado' };
  if (!i.aiConfigured) return { answer: false, reason: 'falta la clave de IA (ANTHROPIC_API_KEY)' };
  if (i.mode === 'TEST' && !isAuthorizedPhone(i.phone, i.testPhones)) return { answer: false, reason: 'modo prueba: no es un teléfono de prueba' };
  // Los proveedores autorizados a mandar remitos no son clientes: esos chats los atiende una persona.
  if (isAuthorizedPhone(i.phone, i.supplierPhones)) return { answer: false, reason: 'es un proveedor' };
  if (i.handoff) return { answer: false, reason: 'derivado a una persona' };
  if (i.pausedUntil && i.pausedUntil > i.now) return { answer: false, reason: 'en pausa: respondió una persona' };
  if (SILENT_TYPES.has(i.messageType)) return { answer: false, reason: `mensaje de tipo ${i.messageType}` };
  if (isWebOrderMessage(i.text)) return { answer: false, reason: 'pedido armado en la web (lo registra el sistema)' };
  if (i.repliesLast24h >= MAX_REPLIES_PER_DAY) return { answer: false, reason: 'llegó al tope de respuestas del día' };
  return { answer: true };
}

/** Pedido armado en la web (con o sin número): lo registra el sistema y lo revisa una persona. */
export function isWebOrderMessage(text: string | null): boolean {
  const head = text?.trim().split('\n')[0]?.replace(/\*/g, '').trim() ?? '';
  return /^Pedido\b.*Sabor a Casa$/i.test(head);
}

// ───────────────────────────── Catálogo ─────────────────────────────

export interface CatalogItem {
  sku: string;
  product: string;
  presentation: string;
  /** Precio de lo que se vende con ese código (una caja, una bolsa, un sobre suelto). */
  price: number;
  /** Para cajas: cuántas unidades trae. */
  unitsPerBox: number | null;
  /** Hay stock disponible ahora (existente menos reservado). Los sueltos se arman abriendo cajas. */
  inStock: boolean;
  loose: boolean;
}

const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export const money = (n: number) => ars.format(Math.round(n)).replace(/\s/g, ' ');

/** El catálogo como lo lee el asistente: una línea por código, agrupado por producto. */
export function catalogText(items: CatalogItem[]): string {
  const sorted = [...items].sort((a, b) => a.product.localeCompare(b.product, 'es', { sensitivity: 'base' }) || a.sku.localeCompare(b.sku));
  return sorted
    .map((i) => {
      const unit = i.unitsPerBox ? ` por caja de ${i.unitsPerBox} (${money(i.price / i.unitsPerBox)} c/u)` : '';
      const stock = i.inStock ? 'hay stock' : i.loose ? 'suelto: se arma abriendo una caja, a confirmar' : 'SIN STOCK';
      return `[${i.sku}] ${i.product} — ${i.presentation} — ${money(i.price)}${unit} — ${stock}`;
    })
    .join('\n');
}

// ───────────────────────────── Pedido ─────────────────────────────

export interface DraftLine {
  sku: string;
  quantity: number;
}

export interface PricedDraft {
  lines: { sku: string; description: string; quantity: number; unitPrice: number; lineTotal: number; inStock: boolean }[];
  total: number;
  unknown: string[];
  noStock: string[];
  belowMinimum: boolean;
}

/** Arma el pedido con los precios del catálogo que vio el cliente; suma el mismo código repetido. */
export function priceDraft(lines: DraftLine[], catalog: CatalogItem[], minOrder: number): PricedDraft {
  const bySku = new Map(catalog.map((c) => [c.sku.toUpperCase(), c]));
  const qty = new Map<string, number>();
  const unknown: string[] = [];
  for (const l of lines) {
    const sku = l.sku.trim().replace(/^\[|\]$/g, '').toUpperCase();
    if (!bySku.has(sku)) {
      unknown.push(l.sku);
      continue;
    }
    if (l.quantity > 0) qty.set(sku, (qty.get(sku) ?? 0) + l.quantity);
  }
  const priced = [...qty].map(([sku, quantity]) => {
    const c = bySku.get(sku)!;
    return {
      sku: c.sku,
      description: `${c.product} ${c.presentation}`,
      quantity,
      unitPrice: c.price,
      lineTotal: Math.round(c.price * quantity * 100) / 100,
      inStock: c.inStock,
    };
  });
  const total = Math.round(priced.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
  return {
    lines: priced,
    total,
    unknown,
    noStock: priced.filter((l) => !l.inStock).map((l) => l.sku),
    belowMinimum: total < minOrder,
  };
}

// ───────────────────────────── Historial ─────────────────────────────

export interface StoredMessage {
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  body: string | null;
  transcript: string | null;
  sentBy: string | null;
  sentAt: Date;
}

export const ASSISTANT_SENDER = 'assistant:whatsapp';

const TYPE_TEXT: Record<string, string> = {
  image: 'una foto',
  video: 'un video',
  audio: 'un audio',
  document: 'un documento',
  sticker: 'un sticker',
  location: 'una ubicación',
  contacts: 'un contacto',
};

/** Texto de un mensaje para el modelo; lo que no puede ver (fotos, audios sin transcribir) se describe. */
export function messageForModel(m: StoredMessage): string {
  const text = m.transcript ?? m.body;
  if (m.type === 'audio') return text ? `[audio transcripto] ${text}` : '[mandó un audio que no se pudo transcribir]';
  if (m.type === 'text' || m.type === 'button' || m.type === 'interactive') return text ?? '';
  const what = TYPE_TEXT[m.type] ?? `un mensaje de tipo ${m.type}`;
  return text ? `[mandó ${what}, que no podés ver, con el texto:] ${text}` : `[mandó ${what}, que no podés ver]`;
}

/**
 * Convierte el chat de WhatsApp en turnos para Claude: lo del cliente es "user"; lo que mandó el asistente
 * o una persona del equipo es "assistant" (lo de una persona va marcado). Turnos seguidos del mismo lado
 * se juntan, y el historial siempre empieza por el cliente.
 */
export function toTurns(messages: StoredMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  const turns: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    const role = m.direction === 'INBOUND' ? 'user' : 'assistant';
    let text = messageForModel(m).trim();
    if (!text) continue;
    if (role === 'assistant' && m.sentBy !== ASSISTANT_SENDER) text = `[Respondió una persona del equipo] ${text}`;
    const last = turns.at(-1);
    if (last?.role === role) last.content += `\n${text}`;
    else turns.push({ role, content: text });
  }
  while (turns[0]?.role === 'assistant') turns.shift();
  return turns;
}
