import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { LlmService } from '../../shared/ai/llm.service';
import { loginCodeIn } from '../customer-portal/portal-code';
import { loadCombos } from '../catalog/application/combos';
import { comboSku } from '../catalog/domain/combos';
import { env } from '../../shared/config/env';
import { AggregateRoot } from '../../shared/domain/aggregate-root';
import { DomainEvent } from '../../shared/domain/domain-event';
import type { Tx } from '../../shared/prisma/prisma.service';
import { nextNumber } from '../../shared/sequences';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { RecommendationsService } from '../catalog/application/recommendations.service';
import { parseVariant } from '../catalog/domain/price-list-pdf';
import { CrmFacade } from '../crm/crm.facade';
import { CollectionsService } from '../receivables/collections.service';
import { InventoryFacade } from '../inventory/inventory.facade';
import { addsVat } from '../invoicing/fiscal-settings.service';
import { WhatsappClient } from '../messaging/whatsapp.client';
import { orderTax } from '../orders/order-tax';
import {
  ASSISTANT_SENDER,
  type AssistantMode,
  type CatalogItem,
  catalogText,
  comboText,
  recommendedText,
  decide,
  topSellersText,
  type DraftLine,
  money,
  priceDraft,
  toTurns,
  isWebOrderMessage,
  webOrderNote,
  webOrderNumber,
  type WebOrderSummary,
} from './domain/assistant';
import { ASSISTANT_SYSTEM, businessText, COVERAGE } from './domain/prompt';
import { findStaffByPhone } from '../../shared/staff/staff-phone';
import { AiOrdersService } from '../staff-assistant/ai-orders.service';
import { instructionsForSales } from '../staff-assistant/domain/staff';
import { StaffAssistantService } from '../staff-assistant/staff-assistant.service';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_ITERATIONS = 6;
/** Cuántos mensajes del chat se le pasan al modelo. */
const HISTORY = 40;
/** Se espera un poco antes de contestar: la gente manda varios mensajes seguidos. */
const DEBOUNCE_MS = 7_000;
/** Para audios: cuánto se espera la transcripción. */
const TRANSCRIPT_WAIT_MS = 30_000;
/** Pedido web sin número: cuánto se espera a que el sistema lo termine de cargar para pasarle el número al cliente. */
const WEB_ORDER_WAIT_MS = 20_000;

/** Cómo ve el cliente cada estado del pedido. */
const STATUS_FOR_CUSTOMER: Record<string, string> = {
  PENDING_REVIEW: 'recibido, por confirmar',
  DRAFT: 'recibido, por confirmar',
  CONFIRMED: 'confirmado',
  PICKING: 'en preparación',
  READY: 'listo para entregar',
  DISPATCHED: 'en camino',
  DELIVERED: 'entregado',
  INVOICED: 'entregado',
  CANCELLED: 'cancelado',
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'registrar_pedido',
    description:
      'Registra el pedido del cliente como "por confirmar" para que lo revise una persona del equipo. Usala solo después de que el cliente confirmó productos, cantidades y total, y dio nombre y dirección de entrega. Si ya registraste un pedido en este chat y nadie lo confirmó, lo reemplaza: mandá siempre el pedido completo. Devuelve el número de pedido y el total, o un error que tenés que explicarle al cliente.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        tipo_cliente: { type: 'string', enum: ['mayorista', 'minorista'], description: 'Mayorista: tiene pedido mínimo. Minorista: sin mínimo, entrega o retiro a coordinar.' },
        combos: {
          type: 'array',
          description: 'Combos para minoristas que lleva, con el código de combo del catálogo y la cantidad. Vacío si no lleva combos.',
          items: {
            type: 'object',
            properties: { codigo: { type: 'string' }, cantidad: { type: 'integer' } },
            required: ['codigo', 'cantidad'],
            additionalProperties: false,
          },
        },
        items: {
          type: 'array',
          description: 'Productos sueltos del pedido (aparte del combo), con el código del catálogo (lo que va entre corchetes) y la cantidad de cajas, bolsas o unidades. Puede estar vacío si solo lleva combos.',
          items: {
            type: 'object',
            properties: { sku: { type: 'string' }, cantidad: { type: 'integer' } },
            required: ['sku', 'cantidad'],
            additionalProperties: false,
          },
        },
        nombre: { type: 'string', description: 'Nombre del cliente o del negocio.' },
        direccion: { type: 'string', description: 'Dirección de entrega (calle y altura).' },
        localidad: { type: 'string' },
        horario: { type: 'string', description: 'Días y horario en que reciben. Vacío si no lo dijo.' },
        notas: { type: 'string', description: 'Aclaraciones del cliente (horario para recibir, referencias). Vacío si no hay.' },
      },
      required: ['tipo_cliente', 'combos', 'items', 'nombre', 'direccion', 'localidad', 'horario', 'notas'],
      additionalProperties: false,
    },
  },
  {
    name: 'pasar_a_humano',
    description:
      'Deriva el chat a una persona del equipo y deja de atenderlo el asistente. Usala en los casos indicados (pedido del cliente, reclamos, pagos, precios especiales, proveedores, dudas que no podés resolver).',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'En una línea, qué necesita el cliente, para la persona que lo va a atender.' } },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
  {
    name: 'ver_pedidos_del_cliente',
    description: 'Últimos pedidos de este cliente (número, fecha, estado, total y productos), para responder cómo va un pedido.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

class OrderEvents extends AggregateRoot {
  emit(e: DomainEvent) {
    this.record(e);
  }
}

type Conversation = NonNullable<Awaited<ReturnType<SalesAssistantService['loadConversation']>>>;

interface RunState {
  conversation: Conversation;
  catalog: CatalogItem[];
  minOrder: number;
  handedOff: boolean;
}

/**
 * Asistente de ventas por WhatsApp: contesta a los clientes con el catálogo, los precios y el stock reales,
 * y registra el pedido "por confirmar" para que lo apruebe una persona. Nunca confirma ni reserva stock.
 * Se calla si una persona del equipo respondió en el chat, si lo derivó, o si el número es de un proveedor.
 */
@Injectable()
export class SalesAssistantService {
  private readonly logger = new Logger(SalesAssistantService.name);
  /** Un chat a la vez: si llegan dos mensajes juntos, el segundo espera y contesta con todo el contexto. */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly uow: UnitOfWork,
    private readonly llm: LlmService,
    private readonly whatsapp: WhatsappClient,
    private readonly crm: CrmFacade,
    private readonly inventory: InventoryFacade,
    private readonly collections: CollectionsService,
    private readonly staffAssistant: StaffAssistantService,
  ) {}

  /** Punto de entrada desde el consumidor de mensajes. Nunca tira: un reintento podría mandar dos veces lo mismo. */
  async onMessage(conversationId: string, messageId: string, type: string): Promise<void> {
    const previous = this.locks.get(conversationId) ?? Promise.resolve();
    const current = previous.then(() => this.handle(conversationId, messageId, type)).catch((e) => {
      this.logger.error(`Asistente: falló en el chat ${conversationId}: ${(e as Error).message}`, (e as Error).stack);
    });
    this.locks.set(conversationId, current);
    await current;
    if (this.locks.get(conversationId) === current) this.locks.delete(conversationId);
  }

  private async handle(conversationId: string, messageId: string, type: string) {
    // El código para entrar al portal de clientes lo contesta el portal, no el asistente.
    const body = await this.uow.read((tx) => tx.message.findUnique({ where: { id: messageId }, select: { body: true } }));
    if (loginCodeIn(body?.body)) return;
    // Si escribe un usuario del sistema (dueño, gerente) desde su celular vinculado, no se le vende: lo atiende el asistente interno.
    const staff = await this.staffFor(conversationId);
    if (staff) return this.staffAssistant.handle(conversationId, messageId, type, staff);
    if (!(await this.shouldAnswer(conversationId, messageId, type))) return;

    // Los mensajes seguidos se contestan juntos: si llegó otro después, contesta ese.
    await sleep(DEBOUNCE_MS);
    if (type === 'audio' && env().STT_URL) await this.waitForTranscript(messageId);
    const latest = await this.uow.read((tx) =>
      tx.message.findFirst({ where: { conversationId }, orderBy: { sentAt: 'desc' }, select: { id: true, direction: true } }),
    );
    if (!latest || latest.direction !== 'INBOUND') return; // ya se contestó (una persona o el asistente)
    if (latest.id !== messageId) {
      const mine = await this.uow.read((tx) => tx.message.findUnique({ where: { id: messageId }, select: { sentAt: true } }));
      const newer = await this.uow.read((tx) => tx.message.findUnique({ where: { id: latest.id }, select: { sentAt: true } }));
      if (mine && newer && newer.sentAt > mine.sentAt) return;
    }
    if (!(await this.shouldAnswer(conversationId, messageId, type))) return; // pudo responder una persona mientras tanto

    await this.reply(conversationId, messageId);
  }

  private async shouldAnswer(conversationId: string, messageId: string, type: string): Promise<boolean> {
    const c = await this.loadConversation(conversationId);
    if (!c) return false;
    const [message, supplierPhones, replies] = await this.uow.read(async (tx) => [
      await tx.message.findUnique({ where: { id: messageId }, select: { body: true, transcript: true } }),
      (await tx.supplier.findMany({ where: { isActive: true }, select: { phone: true, receiptPhones: true } })).flatMap((s) => [
        ...s.receiptPhones,
        ...(s.phone ? [s.phone] : []),
      ]),
      await tx.message.count({ where: { conversationId, sentBy: ASSISTANT_SENDER, sentAt: { gt: new Date(Date.now() - 24 * 3600_000) } } }),
    ]);
    const d = decide({
      mode: c.account.assistantMode as AssistantMode,
      aiConfigured: !!env().ANTHROPIC_API_KEY,
      phone: c.waContactId,
      testPhones: c.account.assistantTestPhones,
      supplierPhones,
      handoff: c.assistantHandoff,
      pausedUntil: c.assistantPausedUntil,
      repliesLast24h: replies,
      messageType: type,
      text: message?.body ?? message?.transcript ?? null,
      now: new Date(),
    });
    if (!d.answer) {
      if (c.account.assistantMode !== 'OFF') this.logger.debug(`Asistente no contesta en ${conversationId}: ${d.reason}`);
      if (d.reason === 'llegó al tope de respuestas del día') await this.handoff(conversationId, 'El asistente llegó al tope de respuestas del día en este chat');
    }
    return d.answer;
  }

  private async staffFor(conversationId: string) {
    return this.uow.read(async (tx) => {
      const c = await tx.conversation.findFirst({ where: { id: conversationId }, select: { waContactId: true } });
      return c ? findStaffByPhone(tx, c.waContactId) : null;
    });
  }

  loadConversation(id: string) {
    return this.uow.read((tx) =>
      tx.conversation.findFirst({
        where: { id },
        include: {
          account: true,
          customer: {
            select: {
              id: true,
              legalName: true,
              tradeName: true,
              status: true,
              addresses: { orderBy: { isDefault: 'desc' }, take: 1, select: { street: true, city: true } },
            },
          },
        },
      }),
    );
  }

  private async waitForTranscript(messageId: string) {
    const until = Date.now() + TRANSCRIPT_WAIT_MS;
    while (Date.now() < until) {
      const m = await this.uow.read((tx) => tx.message.findUnique({ where: { id: messageId }, select: { transcript: true } }));
      if (m?.transcript) return;
      await sleep(2_000);
    }
  }

  /** Un turno del asistente: arma el contexto, corre el bucle con las herramientas y manda la respuesta. */
  private async reply(conversationId: string, messageId: string) {
    const ctx = RequestContextStore.get();
    const webOrder = await this.webOrderFor(conversationId, messageId);
    const conversation = (await this.loadConversation(conversationId))!;
    const [catalog, recommended, topSellers, instructions, history] = await Promise.all([
      this.uow.read((tx) => this.loadCatalog(tx)),
      this.uow.read((tx) => RecommendationsService.active(tx)),
      this.uow.read((tx) => this.loadTopSellers(tx)),
      this.uow.read((tx) => AiOrdersService.activeTexts(tx)),
      this.uow.read((tx) =>
        tx.message.findMany({
          where: { conversationId },
          orderBy: { sentAt: 'desc' },
          take: HISTORY,
          select: { direction: true, type: true, body: true, transcript: true, sentBy: true, sentAt: true },
        }),
      ),
    ]);
    const turns = toTurns(history.reverse());
    if (turns.at(-1)?.role !== 'user') return;

    const state: RunState = { conversation, catalog, minOrder: Number(conversation.account.assistantMinOrder), handedOff: false };
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: ASSISTANT_SYSTEM },
      {
        type: 'text',
        text: `Catálogo vigente (código, producto, presentación, precio):\n${catalogText(catalog)}\n\n${topSellersText(topSellers)}\n\n${recommendedText(recommended, catalog)}\n\n${comboText(catalog)}`,
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: [
          businessText({ minOrder: state.minOrder, coverage: COVERAGE, notes: conversation.account.assistantNotes, now: new Date() }),
          instructionsForSales(instructions),
          this.customerText(conversation),
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
      ...(webOrder ? [{ type: 'text' as const, text: webOrderNote(webOrder.order, state.minOrder) }] : []),
    ];
    const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));

    const run = await this.uow.run((tx) =>
      tx.agentRun.create({ data: { tenantId: ctx.tenantId, agent: 'whatsapp_sales', trigger: 'event', model: this.llm.model } }),
    );
    const usage = { input: 0, output: 0 };
    let text = '';
    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const res = await this.llm.client.messages.create(
          {
            model: this.llm.model,
            max_tokens: 8000,
            system,
            tools: TOOLS,
            messages,
            output_config: { effort: 'low' },
            fallbacks: 'default',
          } as unknown as Anthropic.MessageCreateParamsNonStreaming,
          { headers: { 'anthropic-beta': FALLBACK_BETA } },
        );
        usage.input += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) * 0.1 + (res.usage.cache_creation_input_tokens ?? 0) * 1.25;
        usage.output += res.usage.output_tokens;
        if (res.stop_reason === 'refusal') {
          text = '';
          await this.handoff(conversationId, 'El asistente no pudo responder este mensaje');
          state.handedOff = true;
          break;
        }
        messages.push({ role: 'assistant', content: res.content });
        text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (res.stop_reason === 'pause_turn') continue;
        if (res.stop_reason !== 'tool_use') break;
        const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of uses) results.push(await this.runTool(run.id, use, state));
        messages.push({ role: 'user', content: results });
        text = '';
      }

      // Si una persona respondió mientras el asistente pensaba, no se manda nada.
      const fresh = await this.loadConversation(conversationId);
      const humanStepped = !!fresh?.assistantPausedUntil && fresh.assistantPausedUntil > new Date();
      if (text && !humanStepped && fresh?.account.assistantMode !== 'OFF') await this.send(conversationId, text);
      await this.finishRun(run.id, 'SUCCEEDED', usage);
    } catch (e) {
      await this.finishRun(run.id, 'FAILED', usage, String(e));
      // Sin respuesta automática: que lo vea una persona.
      await this.handoff(conversationId, `El asistente tuvo un error y no respondió (${(e as Error).message.slice(0, 120)})`);
      throw e;
    }
  }

  /**
   * Si el mensaje es un pedido armado en la web, busca el pedido que registró el sistema (por el número, o el que
   * cargó a partir de este mensaje si vino sin número) y lo vincula a este chat: así el asistente lo confirma enseguida,
   * lo ve con ver_pedidos_del_cliente y, si el cliente cambia algo, lo reemplaza en vez de duplicarlo.
   * Devuelve null si el mensaje no es un pedido web; { order: null } si es uno pero no se encontró el pedido.
   */
  private async webOrderFor(conversationId: string, messageId: string): Promise<{ order: WebOrderSummary | null } | null> {
    const message = await this.uow.read((tx) => tx.message.findUnique({ where: { id: messageId }, select: { body: true } }));
    const text = message?.body ?? null;
    if (!isWebOrderMessage(text)) return null;
    const number = webOrderNumber(text);
    const where = number
      ? { number }
      : { statusHistory: { some: { reason: `Recibido por WhatsApp sin número de pedido (mensaje ${messageId})` } } };
    const until = Date.now() + (number ? 0 : WEB_ORDER_WAIT_MS);
    for (;;) {
      const order = await this.uow.read((tx) =>
        tx.salesOrder.findFirst({
          where,
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            customerId: true,
            conversationId: true,
            notes: true,
            customer: { select: { addresses: { take: 1, select: { id: true } } } },
            lines: { select: { quantity: true, lineTotal: true, variant: { select: { name: true, product: { select: { name: true } } } } } },
          },
        }),
      );
      if (order) {
        await this.uow.run(async (tx) => {
          if (!order.conversationId) await tx.salesOrder.update({ where: { id: order.id }, data: { conversationId } });
          if (order.customerId) await tx.conversation.updateMany({ where: { id: conversationId, customerId: null }, data: { customerId: order.customerId } });
        });
        return {
          order: {
            number: order.number,
            status: STATUS_FOR_CUSTOMER[order.status] ?? order.status,
            retail: /Pedido web \(minorista\)/i.test(order.notes ?? '') || /^Modo:\s*Minorista/im.test(text ?? ''),
            total: Number(order.total),
            lines: order.lines.map((l) => `${Number(l.quantity)} × ${l.variant.product.name} ${l.variant.name} = ${money(Number(l.lineTotal))}`),
            hasAddress: !!order.customer?.addresses.length,
          },
        };
      }
      if (Date.now() >= until) return { order: null };
      await sleep(2_000);
    }
  }

  private customerText(c: Conversation): string {
    const name = c.customer?.tradeName ?? c.customer?.legalName ?? c.contactName;
    const address = c.customer?.addresses[0];
    return [
      'Datos del cliente de este chat:',
      `- Nombre: ${name ?? 'no lo sabemos'}${c.customer ? (c.customer.status === 'PROSPECT' ? ' (cliente nuevo)' : ' (cliente)') : ' (no está registrado todavía)'}`,
      `- Teléfono: +${c.waContactId.replace(/^\+/, '')}`,
      address ? `- Dirección de entrega registrada: ${address.street}, ${address.city}` : '- Dirección de entrega: no la tenemos',
    ].join('\n');
  }

  private async runTool(runId: string, use: Anthropic.ToolUseBlock, state: RunState): Promise<Anthropic.ToolResultBlockParam> {
    const started = Date.now();
    let output: unknown;
    let isError = false;
    try {
      if (use.name === 'registrar_pedido') output = await this.registerOrder(state, use.input as OrderToolInput);
      else if (use.name === 'pasar_a_humano') {
        const motivo = String((use.input as { motivo?: string }).motivo ?? '').slice(0, 300) || 'El cliente necesita una persona';
        await this.handoff(state.conversation.id, motivo);
        state.handedOff = true;
        output = { ok: true, mensaje: 'Listo: el chat quedó para una persona del equipo. Avisale al cliente que en breve le responden.' };
      } else if (use.name === 'ver_pedidos_del_cliente') output = await this.customerOrders(state.conversation);
      else throw new Error(`Herramienta desconocida: ${use.name}`);
    } catch (e) {
      isError = true;
      output = { error: (e as Error).message };
    }
    await this.uow.run((tx) =>
      tx.toolCall.create({
        data: {
          runId,
          tool: use.name,
          input: use.input as object,
          output: output as object,
          isWrite: use.name !== 'ver_pedidos_del_cliente',
          durationMs: Date.now() - started,
        },
      }),
    );
    return { type: 'tool_result', tool_use_id: use.id, is_error: isError || undefined, content: JSON.stringify(output) };
  }

  /** Crea (o reemplaza, si nadie lo confirmó) el pedido "por confirmar" de este chat, con los precios del catálogo. */
  private async registerOrder(state: RunState, input: OrderToolInput) {
    const draftLines: DraftLine[] = (input.items ?? []).map((i) => ({ sku: String(i.sku), quantity: Math.trunc(Number(i.cantidad)) }));
    const retail = input.tipo_cliente === 'minorista';
    const firstPurchase = await this.isFirstPurchase(state.conversation);
    const draft = priceDraft(draftLines, state.catalog, { minOrder: state.minOrder, retail, combos: comboRequests(input), firstPurchase });
    if (draft.unknown.length) throw new Error(`Estos códigos no están en el catálogo: ${draft.unknown.join(', ')}. Revisalos con el cliente.`);
    if (draft.comboUnavailable.length) throw new Error(`Este combo no está disponible ahora: ${draft.comboUnavailable.join(', ')}. Ofrecé los sueltos por separado o el otro combo.`);
    if (!draft.lines.length) throw new Error('El pedido no tiene productos.');
    if (draft.belowMinimum) {
      throw new Error(`El total es ${money(draft.total)} y el pedido mínimo para mayoristas es ${money(state.minOrder)}: faltan ${money(state.minOrder - draft.total)}. No se registró.`);
    }
    const c = state.conversation;
    const ctx = RequestContextStore.get();
    const name = input.nombre?.trim() || c.contactName || `+${c.waContactId}`;
    const phone = `+${c.waContactId.replace(/^\+/, '')}`;

    const result = await this.uow.run(async (tx, scope) => {
      const branch =
        (await tx.branch.findFirst({ where: { isMain: true }, select: { id: true } })) ??
        (await tx.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }));
      const warehouse = branch && (await tx.warehouse.findFirst({ where: { branchId: branch.id, isActive: true }, orderBy: { code: 'asc' }, select: { id: true } }));
      if (!branch || !warehouse) throw new Error('La empresa no tiene depósito configurado: pasá el chat a una persona.');

      const variants = await tx.productVariant.findMany({
        where: { sku: { in: draft.lines.map((l) => l.sku) }, isActive: true },
        select: { id: true, sku: true, currentCost: true },
      });
      const bySku = new Map(variants.map((v) => [v.sku, v]));
      const missing = draft.lines.filter((l) => !bySku.has(l.sku));
      if (missing.length) throw new Error(`Ya no están disponibles: ${missing.map((l) => l.description).join(', ')}.`);

      let customerId = c.customerId ?? (await this.crm.findIdByPhone(tx, phone));
      const createdCustomer = !customerId;
      if (!customerId) {
        const priceList = await tx.priceList.findFirst({ where: { name: { equals: 'Mayorista', mode: 'insensitive' } }, select: { id: true } });
        customerId = (await this.crm.createWebProspect(tx, scope, { name, phone, priceListId: priceList?.id ?? null })).id;
      }
      if (!c.customerId) await tx.conversation.update({ where: { id: c.id }, data: { customerId } });

      const lines = draft.lines.map((l) => {
        const v = bySku.get(l.sku)!;
        return { variantId: v.id, quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, unitCost: Number(v.currentCost), lineTotal: l.lineTotal };
      });
      const margin = lines.reduce((s, l) => s + l.lineTotal - l.unitCost * l.quantity, 0);
      const notes = [
        'Armado por el asistente de WhatsApp: revisá productos, zona y stock antes de confirmar.',
        retail ? 'Cliente minorista: sin pedido mínimo; coordinar entrega o retiro.' : 'Cliente mayorista.',
        `Entrega: ${input.direccion.trim()}, ${input.localidad.trim()}.`,
        input.horario?.trim() ? `Recibe: ${input.horario.trim()}.` : null,
        comboSummary(input) ? `Lleva ${comboSummary(input)}${draft.discountTotal > 0 ? ' (con descuento por primera compra)' : ''}.` : null,
        input.notas?.trim() ? `Notas del cliente: ${input.notas.trim()}` : null,
        draft.noStock.length ? `Sin stock al registrar (confirmar): ${draft.lines.filter((l) => !l.inStock).map((l) => l.description).join(', ')}.` : null,
      ]
        .filter(Boolean)
        .join('\n');
      const data = {
        customerId,
        subtotal: draft.subtotal,
        discountTotal: draft.discountTotal,
        total: draft.total,
        taxTotal: orderTax(draft.total, false, await addsVat(tx)).taxTotal,
        marginTotal: Math.round(margin * 100) / 100,
        notes,
        contactName: name,
        contactPhone: phone,
        webTotal: draft.total,
      };

      const previous = await tx.salesOrder.findFirst({
        where: { conversationId: c.id, status: 'PENDING_REVIEW' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, number: true },
      });
      if (previous) {
        await tx.salesOrderLine.deleteMany({ where: { orderId: previous.id } });
        await tx.salesOrder.update({ where: { id: previous.id }, data: { ...data, version: { increment: 1 }, lines: { create: lines } } });
        scope.auditLog({ action: 'order.update', entityType: 'order', entityId: previous.id, after: { number: previous.number, total: draft.total, by: 'asistente' } });
        return { number: previous.number, replaced: true, overdue: await this.collections.overdueDebt(tx, customerId) };
      }

      const id = randomUUID();
      const number = await nextNumber(tx, branch.id, 'order', 'PED-');
      await tx.salesOrder.create({
        data: {
          ...data,
          id,
          tenantId: ctx.tenantId,
          branchId: branch.id,
          warehouseId: warehouse.id,
          number,
          status: 'PENDING_REVIEW',
          channel: 'whatsapp',
          conversationId: c.id,
          createdCustomer,
          lines: { create: lines },
          statusHistory: { create: { to: 'PENDING_REVIEW', changedBy: ASSISTANT_SENDER, reason: 'Armado por el asistente de WhatsApp' } },
        },
      });
      const events = new OrderEvents();
      events.emit(new DomainEvent('order.created', 'order', id, { orderId: id, number, customerId, total: draft.total, channel: 'whatsapp' }));
      scope.track(events);
      scope.auditLog({ action: 'order.create', entityType: 'order', entityId: id, after: { number, total: draft.total, channel: 'whatsapp', by: 'asistente' } });
      return { number, replaced: false, overdue: await this.collections.overdueDebt(tx, customerId) };
    });

    this.logger.log(`Asistente: pedido ${result.number} ${result.replaced ? 'actualizado' : 'registrado'} (${money(draft.total)})`);
    return {
      ok: true,
      numero: result.number,
      reemplazo_al_anterior: result.replaced,
      total: money(draft.total),
      productos: draft.lines.map((l) => `${l.quantity} × ${l.description}${l.fromCombo ? ` (${l.fromCombo})` : ''} = ${money(l.lineTotal)}`),
      descuento: draft.discountTotal > 0 ? `${money(draft.discountTotal)} (descuento del combo por primera compra)` : null,
      entrega: retail ? 'a coordinar con el equipo (entrega o retiro)' : 'la confirma el equipo',
      estado: 'por confirmar: una persona del equipo lo revisa y confirma por este chat la entrega y la forma de pago',
      // Pedido de Nacho: con deuda vencida se toma el pedido, pero se avisa que no se entrega hasta regularizar.
      ...(result.overdue && {
        aviso_deuda_vencida: `El cliente tiene un saldo vencido de ${money(result.overdue.amount)}. Decile con amabilidad que el pedido queda registrado, pero que no se puede entregar hasta que regularice ese saldo, y que el equipo le pasa el detalle. No des más datos de la deuda.`,
      }),
    };
  }

  /** Primera compra: el cliente no tiene pedidos (fuera del que se está armando en este chat y los cancelados). */
  private async isFirstPurchase(c: Conversation): Promise<boolean> {
    const phone = `+${c.waContactId.replace(/^\+/, '')}`;
    const customerId = c.customerId ?? (await this.uow.read((tx) => this.crm.findIdByPhone(tx, phone)));
    const others = await this.uow.read((tx) =>
      tx.salesOrder.count({
        where: {
          ...(customerId ? { customerId } : { contactPhone: phone }),
          status: { not: 'CANCELLED' },
          // Fuera el pedido que se está armando en este chat (ojo: conversation_id es NULL en los demás).
          OR: [{ conversationId: null }, { conversationId: { not: c.id } }, { status: { not: 'PENDING_REVIEW' } }],
        },
      }),
    );
    return others === 0;
  }

  private async customerOrders(c: Conversation) {
    const phone = `+${c.waContactId.replace(/^\+/, '')}`;
    const orders = await this.uow.read((tx) =>
      tx.salesOrder.findMany({
        where: c.customerId ? { customerId: c.customerId } : { contactPhone: phone },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          number: true,
          status: true,
          createdAt: true,
          total: true,
          taxTotal: true,
          lines: { select: { quantity: true, variant: { select: { name: true, product: { select: { name: true } } } } } },
        },
      }),
    );
    if (!orders.length) return { pedidos: [], nota: 'No tiene pedidos registrados.' };
    return {
      pedidos: orders.map((o) => ({
        numero: o.number,
        fecha: o.createdAt.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
        estado: STATUS_FOR_CUSTOMER[o.status] ?? o.status,
        total: money(Number(o.total) + Number(o.taxTotal)),
        productos: o.lines.map((l) => `${Number(l.quantity)} × ${l.variant.product.name} ${l.variant.name}`),
      })),
    };
  }

  /** Deriva el chat a una persona: el asistente no vuelve a contestar ahí hasta que lo reactiven. */
  async handoff(conversationId: string, reason: string) {
    await this.uow.run((tx) =>
      tx.conversation.updateMany({
        where: { id: conversationId, assistantHandoff: null },
        data: { assistantHandoff: reason.slice(0, 300), assistantHandoffAt: new Date(), status: 'OPEN' },
      }),
    );
  }

  /** Manda por WhatsApp y lo guarda como saliente del asistente. No marca el chat como leído: el equipo lo sigue viendo. */
  private async send(conversationId: string, text: string) {
    const ctx = RequestContextStore.get();
    const conv = await this.uow.read((tx) => tx.conversation.findFirstOrThrow({ where: { id: conversationId }, include: { account: true } }));
    if (!conv.windowExpiresAt || conv.windowExpiresAt < new Date()) return;
    const body = text.slice(0, 4000);
    const waId = await this.whatsapp.sendText(conv.account, conv.waContactId, body);
    const now = new Date();
    await this.uow.run(async (tx) => {
      await tx.message.create({
        data: { tenantId: ctx.tenantId, conversationId, waMessageId: waId, direction: 'OUTBOUND', type: 'text', body, status: 'SENT', sentBy: ASSISTANT_SENDER, sentAt: now },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
    });
  }

  /**
   * Catálogo que ofrece el asistente: la lista Mayorista (o la por defecto) y los sueltos de la Minorista,
   * igual que la lista de precios en PDF. Solo productos activos, con el stock disponible del depósito principal.
   */
  /** Los 8 productos con más venta de los últimos 90 días (pedidos no cancelados), solo activos. */
  async loadTopSellers(tx: Tx): Promise<string[]> {
    const rows = await tx.$queryRaw<{ name: string }[]>`
      SELECT p.name
      FROM sales_order_lines l
      JOIN sales_orders o ON o.id = l.order_id
      JOIN product_variants v ON v.id = l.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE o.status <> 'CANCELLED' AND o.created_at > now() - interval '90 days'
        AND p.is_active AND p.deleted_at IS NULL
      GROUP BY p.name
      ORDER BY sum(l.line_total) DESC
      LIMIT 8`;
    return rows.map((r) => r.name);
  }

  async loadCatalog(tx: Tx): Promise<CatalogItem[]> {
    const lists = await tx.priceList.findMany({ select: { id: true, name: true, isDefault: true } });
    const wholesale = lists.find((l) => l.name.toLowerCase() === 'mayorista') ?? lists.find((l) => l.isDefault);
    if (!wholesale) return [];
    const retail = lists.find((l) => l.name.toLowerCase() === 'minorista' && l.id !== wholesale.id);
    const rows = await tx.priceListItem.findMany({
      where: {
        priceListId: { in: [wholesale.id, ...(retail ? [retail.id] : [])] },
        minQuantity: 1,
        // Los combos van aparte (con sus sobres).
        variant: { isActive: true, kitComponents: { none: {} }, product: { isActive: true, deletedAt: null } },
      },
      select: { priceListId: true, price: true, variant: { select: { id: true, sku: true, name: true, product: { select: { name: true } } } } },
    });

    const branch =
      (await tx.branch.findFirst({ where: { isMain: true }, select: { id: true } })) ??
      (await tx.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }));
    const warehouse = branch && (await tx.warehouse.findFirst({ where: { branchId: branch.id, isActive: true }, orderBy: { code: 'asc' }, select: { id: true } }));
    const combos = (await loadCombos(tx)).filter((c) => c.available);
    const ids = [...new Set([...rows.map((r) => r.variant.id), ...combos.map((c) => c.variantId)])];
    const available = warehouse ? await this.inventory.available(tx, warehouse.id, ids) : new Map<string, number>();

    const items = new Map<string, CatalogItem>();
    for (const r of rows) {
      const p = parseVariant(r.variant.name);
      const isRetail = r.priceListId !== wholesale.id;
      if (isRetail && p.kind !== 'loose') continue; // de la minorista, solo los sueltos
      if (items.has(r.variant.sku) && isRetail) continue;
      items.set(r.variant.sku, {
        sku: r.variant.sku,
        product: r.variant.product.name,
        presentation: p.presentation,
        price: Number(r.price),
        unitsPerBox: p.kind === 'box' ? p.units : null,
        inStock: (available.get(r.variant.id) ?? 0) > 0,
        loose: p.kind === 'loose',
      });
    }
    // Combos: se venden en una línea con su SKU y descuentan cada sobre. Los sobres sueltos se arman
    // abriendo cajas, así que se ofrecen igual que los sueltos (el equipo confirma al revisar).
    for (const c of combos) {
      items.set(c.sku, {
        sku: c.sku,
        product: c.name,
        presentation: c.presentation,
        price: c.price!,
        unitsPerBox: null,
        inStock: (available.get(c.variantId) ?? 0) > 0,
        loose: true,
        combo: {
          code: c.code,
          items: c.items.map((i) => ({ sku: i.sku, description: `${i.product} ${i.presentation}`, quantity: i.quantity })),
          looseTotal: c.looseTotal,
          firstPurchaseDiscountPct: c.firstPurchaseDiscountPct,
        },
      });
    }
    return [...items.values()];
  }

  private async finishRun(id: string, status: string, usage: { input: number; output: number }, error?: string) {
    await this.uow
      .run((tx) =>
        tx.agentRun.update({
          where: { id },
          data: {
            status,
            inputTokens: Math.round(usage.input),
            outputTokens: usage.output,
            costUsd: (usage.input * 4 + usage.output * 20) / 1_000_000,
            finishedAt: new Date(),
            error: error?.slice(0, 1000),
          },
        }),
      )
      .catch(() => undefined);
  }
}

interface OrderToolInput {
  tipo_cliente: 'mayorista' | 'minorista';
  combos: { codigo: string; cantidad: number }[];
  horario: string;
  items: { sku: string; cantidad: number }[];
  nombre: string;
  direccion: string;
  localidad: string;
  notas: string;
}

/** Lo que pidió el modelo; acepta el formato viejo (un número = combos Chef) por si queda en un historial. */
function comboRequests(input: OrderToolInput): { code: string; quantity: number }[] {
  const raw = input.combos as unknown;
  if (typeof raw === 'number') return raw > 0 ? [{ code: 'CHEF', quantity: raw }] : [];
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => ({ code: String(c?.codigo ?? ''), quantity: Math.trunc(Number(c?.cantidad)) || 0 })).filter((c) => c.code && c.quantity > 0);
}

/** "1 × Combo Esencial, 2 × Combo Chef". */
function comboSummary(input: OrderToolInput): string {
  return comboRequests(input)
    .map((c) => `${c.quantity} × ${comboSku(c.code)}`)
    .join(', ');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
