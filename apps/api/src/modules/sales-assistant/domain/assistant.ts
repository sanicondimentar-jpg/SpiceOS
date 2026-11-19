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

/**
 * El catálogo como lo lee el asistente, en dos partes: lo mayorista (cajas, bolsas) y los sueltos para
 * minoristas. Lo que no tiene stock se marca para no ofrecerlo; el asistente nunca habla de stock.
 * Los sueltos se arman abriendo cajas, así que se ofrecen siempre (el equipo confirma al revisar).
 */
export function catalogText(items: CatalogItem[]): string {
  const sorted = [...items].sort((a, b) => a.product.localeCompare(b.product, 'es', { sensitivity: 'base' }) || a.sku.localeCompare(b.sku));
  const line = (i: CatalogItem) => {
    const unit = i.unitsPerBox ? ` por caja de ${i.unitsPerBox} (${money(i.price / i.unitsPerBox)} c/u)` : '';
    const hide = !i.inStock && !i.loose ? ' — NO OFRECER' : '';
    return `[${i.sku}] ${i.product} — ${i.presentation} — ${money(i.price)}${unit}${hide}`;
  };
  return [
    'MAYORISTA (cajas y bolsas):',
    ...sorted.filter((i) => !i.loose).map(line),
    '',
    'SUELTOS PARA MINORISTAS (precio por unidad):',
    ...sorted.filter((i) => i.loose).map(line),
  ].join('\n');
}

// ───────────────────────────── Más vendidos ─────────────────────────────

/** Mientras haya pocas ventas registradas, los básicos que más rotan (los del combo). */
export const DEFAULT_TOP_SELLERS = ['Pimienta Negra Molida', 'Pimentón', 'Orégano en Hojas', 'Ají Molido'];

/** Los productos que más rotan, para ofrecerlos primero y después sumar variedad con el resto. */
export function topSellersText(fromSales: string[]): string {
  const names = fromSales.length >= 4 ? fromSales : [...new Set([...fromSales, ...DEFAULT_TOP_SELLERS])];
  return `Productos que más rotan (ofrecelos primero): ${names.join(', ')}.`;
}

// ───────────────────────────── Combo minorista ─────────────────────────────

/** Combo básico para minoristas (definido con Nacho): sobres sueltos de 25 g; el precio sale del catálogo. */
export const RETAIL_COMBO = {
  name: 'Combo básico',
  items: [
    { sku: '179-U', quantity: 10 }, // Pimienta negra molida, sobre 25 g
    { sku: '41-U', quantity: 10 }, // Pimentón seleccionado, sobre 25 g
    { sku: '141-U', quantity: 10 }, // Orégano en hojas, sobre 25 g
    { sku: '60-U', quantity: 10 }, // Ají molido, sobre 25 g
  ],
  /** Descuento sobre el combo solo en la primera compra del cliente. */
  firstPurchaseDiscountPct: 10,
};

export interface ComboInfo {
  available: boolean;
  lines: { sku: string; description: string; quantity: number; unitPrice: number }[];
  price: number;
  firstPurchasePrice: number;
}

/** Composición y precio del combo con los precios vigentes; no disponible si falta algún producto. */
export function comboInfo(catalog: CatalogItem[]): ComboInfo {
  const bySku = new Map(catalog.map((c) => [c.sku.toUpperCase(), c]));
  const lines = RETAIL_COMBO.items
    .map((i) => ({ i, c: bySku.get(i.sku.toUpperCase()) }))
    .filter((x): x is { i: (typeof RETAIL_COMBO.items)[number]; c: CatalogItem } => !!x.c)
    .map(({ i, c }) => ({ sku: c.sku, description: `${c.product} ${c.presentation}`, quantity: i.quantity, unitPrice: c.price }));
  const price = round2(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
  return {
    available: lines.length === RETAIL_COMBO.items.length,
    lines,
    price,
    firstPurchasePrice: round2(price * (1 - RETAIL_COMBO.firstPurchaseDiscountPct / 100)),
  };
}

export function comboText(catalog: CatalogItem[]): string {
  const c = comboInfo(catalog);
  if (!c.available) return 'Combo para minoristas: no disponible por ahora (no lo ofrezcas).';
  return [
    `${RETAIL_COMBO.name} para minoristas (se pide con el campo "combos" de registrar_pedido):`,
    ...c.lines.map((l) => `- ${l.quantity} × ${l.description} [${l.sku}]`),
    `Precio: ${money(c.price)}. En la primera compra del cliente tiene ${RETAIL_COMBO.firstPurchaseDiscountPct}% de descuento: ${money(c.firstPurchasePrice)}.`,
  ].join('\n');
}

// ───────────────────────────── Pedido ─────────────────────────────

export interface DraftLine {
  sku: string;
  quantity: number;
}

export interface DraftOptions {
  minOrder: number;
  /** Minorista: no corre el pedido mínimo. */
  retail: boolean;
  /** Cantidad de combos básicos. */
  combos: number;
  /** Primera compra del cliente: el combo va con descuento. */
  firstPurchase: boolean;
}

export interface PricedLine {
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  lineTotal: number;
  inStock: boolean;
  fromCombo: boolean;
}

export interface PricedDraft {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  total: number;
  unknown: string[];
  noStock: string[];
  belowMinimum: boolean;
  comboUnavailable: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Arma el pedido con los precios del catálogo que vio el cliente; suma el mismo código repetido. */
export function priceDraft(lines: DraftLine[], catalog: CatalogItem[], opts: DraftOptions): PricedDraft {
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
  const line = (c: CatalogItem, quantity: number, discountPct: number, fromCombo: boolean): PricedLine => ({
    sku: c.sku,
    description: `${c.product} ${c.presentation}`,
    quantity,
    unitPrice: c.price,
    discountPct,
    lineTotal: round2(c.price * quantity * (1 - discountPct / 100)),
    inStock: c.inStock || c.loose,
    fromCombo,
  });
  const priced = [...qty].map(([sku, quantity]) => line(bySku.get(sku)!, quantity, 0, false));

  const combo = comboInfo(catalog);
  const combos = Math.max(0, Math.trunc(opts.combos));
  if (combos && combo.available) {
    const pct = opts.firstPurchase ? RETAIL_COMBO.firstPurchaseDiscountPct : 0;
    for (const l of combo.lines) priced.push(line(bySku.get(l.sku.toUpperCase())!, l.quantity * combos, pct, true));
  }

  const subtotal = round2(priced.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
  const total = round2(priced.reduce((s, l) => s + l.lineTotal, 0));
  return {
    lines: priced,
    subtotal,
    discountTotal: round2(subtotal - total),
    total,
    unknown,
    noStock: priced.filter((l) => !l.inStock).map((l) => l.sku),
    belowMinimum: !opts.retail && total < opts.minOrder,
    comboUnavailable: combos > 0 && !combo.available,
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
