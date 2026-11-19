import { comboSku } from '../../catalog/domain/combos';
import { recommendationsText, type Segment } from '../../catalog/domain/recommendations';
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
  // Los pedidos armados en la web sí se contestan: el sistema los registra y el asistente le confirma al cliente enseguida.
  if (i.repliesLast24h >= MAX_REPLIES_PER_DAY) return { answer: false, reason: 'llegó al tope de respuestas del día' };
  return { answer: true };
}

/** Pedido armado en la web (con o sin número): lo registra el sistema y lo revisa una persona. */
export function isWebOrderMessage(text: string | null): boolean {
  return /^Pedido\b.*Sabor a Casa$/i.test(webOrderHead(text));
}

/** El número del pedido web ("*Pedido PED-00000012 — Sabor a Casa*"), o null si vino sin número. */
export function webOrderNumber(text: string | null): string | null {
  return webOrderHead(text).match(/^Pedido\s+(PED-[\w-]+)/i)?.[1]?.toUpperCase() ?? null;
}

function webOrderHead(text: string | null): string {
  return text?.trim().split('\n')[0]?.replace(/\*/g, '').trim() ?? '';
}

export interface WebOrderSummary {
  number: string;
  /** Lo que ve el cliente (STATUS_FOR_CUSTOMER). */
  status: string;
  retail: boolean;
  /** Suma de los productos, sin impuestos (como lo muestra la web). */
  total: number;
  lines: string[];
  hasAddress: boolean;
}

/**
 * Instrucciones para contestar en el momento un pedido que el cliente armó en la web y mandó por WhatsApp.
 * El pedido ya lo registró el sistema: el asistente confirma, resume y cuenta los próximos pasos, sin registrarlo de nuevo.
 */
export function webOrderNote(order: WebOrderSummary | null, minOrder: number): string {
  const common = [
    'El último mensaje del cliente es un pedido que armó en la web y nos mandó por WhatsApp. Respondele ahora, en un solo mensaje corto:',
    '- agradecele y confirmale que lo recibimos;',
    '- contale los próximos pasos: una persona del equipo lo revisa y le confirma por este chat la entrega (o el retiro) y la forma de pago, sin prometer fechas;',
  ];
  if (!order) {
    return [
      ...common,
      '- todavía no tenemos el número de pedido: decile que el equipo lo carga y se lo pasa. No uses registrar_pedido con este pedido.',
      'Si falta la dirección de entrega con localidad o el horario en que reciben, pedíselos.',
    ].join('\n');
  }
  const below = !order.retail && order.total < minOrder;
  return [
    ...common,
    `- decile el número de pedido, *${order.number}*, que le sirve para seguirlo en www.saboracasa.com.ar/seguimiento;`,
    '- resumilo en pocas líneas (no repitas todo el detalle que ya mandó) con el total.',
    order.hasAddress ? null : 'No tenemos su dirección: pedile la dirección de entrega con localidad y el horario en que reciben.',
    below ? `Es mayorista y el total no llega al pedido mínimo (${money(minOrder)}): avisale con amabilidad cuánto le falta y ofrecele sumar productos.` : null,
    'Este pedido ya está registrado: NO uses registrar_pedido salvo que el cliente pida cambiarlo (en ese caso mandá el pedido completo y lo reemplaza).',
    'Si en el mismo mensaje hizo una pregunta, contestala también.',
    `Pedido registrado: ${order.number}, ${order.retail ? 'minorista' : 'mayorista'}, estado ${order.status}, total ${money(order.total)}.`,
    ...order.lines.map((l) => `- ${l}`),
  ]
    .filter(Boolean)
    .join('\n');
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
  /** Si es un combo: su código corto, los sobres que lleva y el descuento de primera compra. */
  combo?: { code: string; items: { sku: string; description: string; quantity: number }[]; looseTotal: number | null; firstPurchaseDiscountPct: number };
}

const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export const money = (n: number) => ars.format(Math.round(n)).replace(/\s/g, ' ');

/**
 * El catálogo como lo lee el asistente, en dos partes: lo mayorista (cajas, bolsas) y los sueltos para
 * minoristas. Lo que no tiene stock se marca para no ofrecerlo; el asistente nunca habla de stock.
 * Los sueltos se arman abriendo cajas, así que se ofrecen siempre (el equipo confirma al revisar).
 */
export function catalogText(items: CatalogItem[]): string {
  // Los combos van aparte (comboText), con sus sobres.
  const sorted = [...items].filter((i) => !i.combo).sort((a, b) => a.product.localeCompare(b.product, 'es', { sensitivity: 'base' }) || a.sku.localeCompare(b.sku));
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

// ───────────────────────────── Recomendados por tipo de cliente ─────────────────────────────

/** Los recomendados (los mismos que la web) con nombre; se saltean los que no hay que ofrecer. */
export function recommendedText(lists: Record<Segment, string[]>, catalog: CatalogItem[]): string {
  const bySku = new Map(catalog.map((c) => [c.sku.toUpperCase(), c]));
  return recommendationsText(lists, (sku) => {
    const c = bySku.get(sku.toUpperCase());
    if (!c || (!c.inStock && !c.loose)) return null;
    return `[${c.sku}] ${c.product} ${c.presentation}`;
  });
}

// ───────────────────────────── Combos minoristas ─────────────────────────────

export function comboText(catalog: CatalogItem[]): string {
  const combos = catalog.filter((c) => c.combo);
  if (!combos.length) return 'Combos para minoristas: no hay disponibles por ahora (no los ofrezcas).';
  const blocks = combos.map((c) => {
    const k = c.combo!;
    const price =
      k.firstPurchaseDiscountPct > 0
        ? `Precio: ${money(c.price)}. En la primera compra del cliente tiene ${k.firstPurchaseDiscountPct}% de descuento: ${money(c.price * (1 - k.firstPurchaseDiscountPct / 100))}.`
        : k.looseTotal != null && c.price < k.looseTotal
          ? `Precio: ${money(c.price)} (sueltos suman ${money(k.looseTotal)}). Sin otros descuentos.`
          : `Precio: ${money(c.price)}.`;
    return [`${c.product} (código de combo "${k.code}"):`, ...k.items.map((i) => `- ${i.quantity} × ${i.description} [${i.sku}]`), price].join('\n');
  });
  return ['Combos para minoristas (se piden con el campo "combos" de registrar_pedido, con su código):', ...blocks].join('\n\n');
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
  /** Combos pedidos, por código ("ESENCIAL", "BASICO"). */
  combos: { code: string; quantity: number }[];
  /** Primera compra del cliente: el combo que lo tenga va con descuento. */
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
  /** Nombre del combo del que sale la línea (null si es un suelto). */
  fromCombo: string | null;
}

export interface PricedDraft {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  total: number;
  unknown: string[];
  noStock: string[];
  belowMinimum: boolean;
  /** Códigos de combo pedidos que no existen o les falta algún sobre. */
  comboUnavailable: string[];
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
  const line = (c: CatalogItem, quantity: number, discountPct: number, fromCombo: string | null): PricedLine => ({
    sku: c.sku,
    description: `${c.product} ${c.presentation}`,
    quantity,
    unitPrice: c.price,
    discountPct,
    lineTotal: round2(c.price * quantity * (1 - discountPct / 100)),
    inStock: c.inStock || c.loose,
    fromCombo,
  });
  const priced = [...qty].map(([sku, quantity]) => line(bySku.get(sku)!, quantity, 0, null));

  // Combos: una línea con su SKU ("COMBO-ESENCIAL"); al reservarse descuenta cada sobre.
  const comboUnavailable: string[] = [];
  for (const req of opts.combos) {
    const quantity = Math.max(0, Math.trunc(req.quantity));
    if (!quantity) continue;
    const c = bySku.get(comboSku(req.code));
    if (!c?.combo) {
      comboUnavailable.push(req.code);
      continue;
    }
    priced.push(line(c, quantity, opts.firstPurchase ? c.combo.firstPurchaseDiscountPct : 0, c.product));
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
    comboUnavailable,
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
