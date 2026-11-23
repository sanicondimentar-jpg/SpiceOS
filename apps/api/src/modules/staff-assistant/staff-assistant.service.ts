import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { PERMISSIONS, type AiOrderAction } from '@spiceos/contracts';
import { LlmService } from '../../shared/ai/llm.service';
import { env } from '../../shared/config/env';
import type { StaffMember } from '../../shared/staff/staff-phone';
import { RequestContextStore, type RequestContext } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { WhatsappClient } from '../messaging/whatsapp.client';
import { ASSISTANT_SENDER, toTurns } from '../sales-assistant/domain/assistant';
import { AiOrdersService } from './ai-orders.service';
import { argentinaDate, isAffirmative, PENDING_TTL_MS, STAFF_SENDER, STAFF_SYSTEM } from './domain/staff';
import { StaffTools, type StaffTool } from './staff-tools';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_ITERATIONS = 10;
const HISTORY = 30;
/** Se espera un poco: se suelen mandar varios mensajes seguidos. */
const DEBOUNCE_MS = 4_000;
const TRANSCRIPT_WAIT_MS = 30_000;
/** Sin permiso para dar órdenes: se avisa una vez cada tanto, no en cada mensaje. */
const NO_PERMISSION_NOTICE_MS = 6 * 3600_000;

interface PendingAction {
  orderId: string;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
}

interface TurnState {
  actions: AiOrderAction[];
  /** Acción delicada que quedó preparada en este turno. */
  prepared: PendingAction | null;
  /** La que venía esperando el sí (de un turno anterior). */
  pending: PendingAction | null;
  pendingResolved: 'CONFIRMED' | 'REJECTED' | null;
  lastText: string;
  orderId: string;
}

/**
 * Asistente interno por WhatsApp: cuando escribe un usuario del sistema (su celular está vinculado a su ficha),
 * no le vende: responde con datos de SpiceOS y hace lo que le pide, con los permisos de su rol.
 * Las acciones delicadas quedan preparadas y solo se ejecutan con un "sí" (lo verifica el código).
 * Cada mensaje queda en "Órdenes a la IA".
 */
@Injectable()
export class StaffAssistantService {
  private readonly logger = new Logger(StaffAssistantService.name);

  constructor(
    private readonly uow: UnitOfWork,
    private readonly llm: LlmService,
    private readonly whatsapp: WhatsappClient,
    private readonly tools: StaffTools,
  ) {}

  /** Lo llama el asistente de WhatsApp (que ya serializa los mensajes de cada chat). Nunca tira. */
  async handle(conversationId: string, messageId: string, type: string, staff: StaffMember): Promise<void> {
    try {
      if (!env().ANTHROPIC_API_KEY) return;
      if (['reaction', 'sticker', 'unsupported', 'system', 'ephemeral'].includes(type)) return;
      await this.uow.run((tx) => tx.conversation.updateMany({ where: { id: conversationId, isInternal: false }, data: { isInternal: true } }));

      await sleep(DEBOUNCE_MS);
      if (type === 'audio' && env().STT_URL) await this.waitForTranscript(messageId);
      if (!(await this.isLatest(conversationId, messageId))) return;

      const ctx = this.contextFor(staff);
      await RequestContextStore.run(ctx, async () => {
        if (!staff.permissions.has(PERMISSIONS.ai.give)) return this.noPermission(conversationId, staff);
        await this.reply(conversationId, messageId, staff);
      });
    } catch (e) {
      this.logger.error(`Asistente interno: falló en el chat ${conversationId}: ${(e as Error).message}`, (e as Error).stack);
    }
  }

  /** Corre con el usuario: mismos permisos que en la pantalla, auditado como IA en su nombre. */
  private contextFor(staff: StaffMember): RequestContext {
    const base = RequestContextStore.get();
    return {
      tenantId: base.tenantId,
      userId: staff.userId,
      actor: 'agent:whatsapp_staff',
      actorType: 'AGENT',
      onBehalfOf: staff.userId,
      roleKey: staff.roleKey,
      permissions: staff.permissions,
      branchScope: staff.branchScope,
      maxDiscount: staff.maxDiscount,
      correlationId: randomUUID(),
    };
  }

  private async reply(conversationId: string, messageId: string, staff: StaffMember) {
    const ctx = RequestContextStore.get();
    const history = await this.uow.read((tx) =>
      tx.message.findMany({
        // Lo de las últimas 24 h, sin lo que haya contestado el asistente de ventas (si antes se probó como cliente).
        where: { conversationId, sentAt: { gt: new Date(Date.now() - 24 * 3600_000) }, OR: [{ sentBy: null }, { sentBy: { not: ASSISTANT_SENDER } }] },
        orderBy: { sentAt: 'desc' },
        take: HISTORY,
        select: { direction: true, type: true, body: true, transcript: true, sentBy: true, sentAt: true },
      }),
    );
    const turns = toTurns(history.reverse(), STAFF_SENDER);
    const last = turns.at(-1);
    if (last?.role !== 'user') return;

    const pending = await this.loadPending(staff.userId);
    const order = await this.uow.run((tx) =>
      tx.aiOrder.create({ data: { tenantId: ctx.tenantId, userId: staff.userId, conversationId, messageId, request: last.content.slice(0, 4000) } }),
    );
    const state: TurnState = { actions: [], prepared: null, pending, pendingResolved: null, lastText: last.content, orderId: order.id };

    const available = this.tools.tools.filter((t) => t.permissions.every((p) => staff.permissions.has(p)));
    const missing = this.tools.tools.filter((t) => !available.includes(t)).map((t) => t.def.name);
    const defs: Anthropic.Tool[] = [...available.map((t) => t.def), ...(pending ? CONFIRM_TOOLS : [])];

    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: STAFF_SYSTEM, cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: [
          `Te escribe ${staff.fullName} (rol: ${staff.roleName}).`,
          missing.length ? `Su rol no tiene permiso para: ${missing.join(', ')}. Si lo pide, explicale que tiene que pedírselo a un dueño.` : null,
          `Hoy es ${new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} (${argentinaDate(new Date())}), ${new Date().toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })} en Argentina.`,
          pending
            ? `Hay una acción delicada esperando su confirmación: "${pending.summary}". Si en su último mensaje la confirma, usá confirmar_accion; si dice que no o pide otra cosa distinta, usá descartar_accion.`
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ];
    const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));

    const run = await this.uow.run((tx) =>
      tx.agentRun.create({ data: { tenantId: ctx.tenantId, agent: 'whatsapp_staff', trigger: 'event', onBehalfOf: staff.userId, model: this.llm.model } }),
    );
    const usage = { input: 0, output: 0 };
    let text = '';
    let failed: string | null = null;
    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const res = await this.llm.client.messages.create(
          {
            model: this.llm.model,
            max_tokens: 8000,
            system,
            tools: defs,
            messages,
            output_config: { effort: 'medium' },
            fallbacks: 'default',
          } as unknown as Anthropic.MessageCreateParamsNonStreaming,
          { headers: { 'anthropic-beta': FALLBACK_BETA } },
        );
        usage.input += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) * 0.1 + (res.usage.cache_creation_input_tokens ?? 0) * 1.25;
        usage.output += res.usage.output_tokens;
        if (res.stop_reason === 'refusal') {
          text = 'No puedo ayudarte con eso.';
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
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')) {
          results.push(await this.runTool(run.id, use, available, state));
        }
        messages.push({ role: 'user', content: results });
        text = '';
      }
    } catch (e) {
      failed = (e as Error).message;
      text = 'Tuve un problema para procesar esto y no hice nada. Probá de nuevo en un rato.';
    }

    if (text) await this.send(conversationId, text);
    await this.finish(state, text, failed);
    await this.uow
      .run((tx) =>
        tx.agentRun.update({
          where: { id: run.id },
          data: {
            status: failed ? 'FAILED' : 'SUCCEEDED',
            inputTokens: Math.round(usage.input),
            outputTokens: usage.output,
            costUsd: (usage.input * 4 + usage.output * 20) / 1_000_000,
            finishedAt: new Date(),
            error: failed?.slice(0, 1000),
          },
        }),
      )
      .catch(() => undefined);
  }

  private async runTool(runId: string, use: Anthropic.ToolUseBlock, available: StaffTool[], state: TurnState): Promise<Anthropic.ToolResultBlockParam> {
    const started = Date.now();
    const input = (use.input ?? {}) as Record<string, unknown>;
    let output: unknown;
    let isError = false;
    try {
      if (use.name === 'confirmar_accion') output = await this.confirmPending(state, available);
      else if (use.name === 'descartar_accion') output = await this.rejectPending(state);
      else {
        const tool = available.find((t) => t.def.name === use.name);
        if (!tool) throw new Error(`Esa acción no está habilitada para tu usuario (${use.name})`);
        if (tool.prepare) {
          const prepared = await tool.prepare(input);
          state.prepared = { orderId: state.orderId, tool: use.name, input: prepared.input, summary: prepared.summary };
          state.actions.push({ tool: use.name, summary: `Preparó: ${prepared.summary}`, ok: true });
          output = {
            preparada: prepared.summary,
            nota: 'NO está hecha. Mostrale esto y pedile que responda "sí" para confirmar. Si cambia algo, prepará la acción de nuevo.',
          };
        } else {
          const r = await tool.run(input);
          state.actions.push({ tool: use.name, summary: r.summary, ok: true });
          output = r.data;
        }
      }
    } catch (e) {
      isError = true;
      const msg = (e as Error).message;
      output = { error: msg };
      state.actions.push({ tool: use.name, summary: `No se pudo: ${msg}`.slice(0, 400), ok: false });
    }
    await this.uow
      .run((tx) =>
        tx.toolCall.create({
          data: { runId, tool: use.name, input: input as object, output: JSON.parse(JSON.stringify(output ?? null)) as object, isWrite: true, durationMs: Date.now() - started },
        }),
      )
      .catch(() => undefined);
    return { type: 'tool_result', tool_use_id: use.id, is_error: isError || undefined, content: JSON.stringify(output).slice(0, 30_000) };
  }

  /** Ejecuta la acción que esperaba el sí, con la entrada guardada. Solo si el último mensaje es un sí claro. */
  private async confirmPending(state: TurnState, available: StaffTool[]) {
    const p = state.pending;
    if (!p || state.pendingResolved) throw new Error('No hay ninguna acción esperando confirmación');
    if (!isAffirmative(state.lastText)) {
      throw new Error('Para confirmar necesito un "sí" claro en su mensaje. Preguntale de nuevo si confirma.');
    }
    const tool = available.find((t) => t.def.name === p.tool);
    if (!tool) throw new Error('Tu usuario ya no tiene permiso para esa acción');
    state.pendingResolved = 'CONFIRMED';
    try {
      const r = await tool.run(p.input);
      state.actions.push({ tool: p.tool, summary: `Confirmó: ${r.summary}`, ok: true });
      await this.closePending(p.orderId, 'CONFIRMED', r.summary);
      return { hecho: r.summary, ...((r.data as object) ?? {}) };
    } catch (e) {
      const msg = (e as Error).message;
      state.actions.push({ tool: p.tool, summary: `Confirmó, pero falló: ${msg}`.slice(0, 400), ok: false });
      await this.closePending(p.orderId, 'FAILED', `Falló al ejecutar: ${msg}`);
      throw e;
    }
  }

  private async rejectPending(state: TurnState) {
    const p = state.pending;
    if (!p || state.pendingResolved) return { ok: true, nota: 'No había nada pendiente' };
    state.pendingResolved = 'REJECTED';
    state.actions.push({ tool: p.tool, summary: `Descartó: ${p.summary}`, ok: true });
    await this.closePending(p.orderId, 'REJECTED');
    return { ok: true, descartada: p.summary };
  }

  private closePending(orderId: string, status: 'CONFIRMED' | 'REJECTED' | 'FAILED' | 'EXPIRED', result?: string) {
    return this.uow.run(async (tx) => {
      const row = await tx.aiOrder.findFirst({ where: { id: orderId }, select: { actions: true } });
      const actions = [...(((row?.actions as unknown as AiOrderAction[]) ?? []) as AiOrderAction[])];
      if (result) actions.push({ tool: 'confirmacion', summary: result, ok: status === 'CONFIRMED' });
      await tx.aiOrder.update({
        where: { id: orderId },
        data: { status, actions: actions as unknown as object, ...(status === 'CONFIRMED' && { confirmedAt: new Date() }) },
      });
    });
  }

  /** La acción que espera el sí de este usuario (la última, si no venció). Las vencidas se marcan. */
  private async loadPending(userId: string): Promise<PendingAction | null> {
    const rows = await this.uow.read((tx) =>
      tx.aiOrder.findMany({ where: { userId, status: 'AWAITING_CONFIRMATION' }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true, pendingAction: true } }),
    );
    const cutoff = Date.now() - PENDING_TTL_MS;
    const [latest, ...older] = rows;
    const stale = [...older, ...(latest && latest.createdAt.getTime() < cutoff ? [latest] : [])];
    for (const r of stale) await this.closePending(r.id, 'EXPIRED');
    if (!latest || latest.createdAt.getTime() < cutoff || !latest.pendingAction) return null;
    const p = latest.pendingAction as unknown as Omit<PendingAction, 'orderId'>;
    return { orderId: latest.id, tool: p.tool, input: p.input, summary: p.summary };
  }

  private async finish(state: TurnState, reply: string, failed: string | null) {
    // Si había una acción esperando y en este turno no se confirmó ni descartó, sigue esperando (salvo que se prepare otra).
    if (state.pending && !state.pendingResolved && state.prepared) await this.closePending(state.pending.orderId, 'EXPIRED');
    await this.uow.run((tx) =>
      tx.aiOrder.update({
        where: { id: state.orderId },
        data: {
          reply: reply.slice(0, 4000) || null,
          actions: state.actions as unknown as object,
          status: failed ? 'FAILED' : state.prepared ? 'AWAITING_CONFIRMATION' : 'DONE',
          ...(state.prepared && { pendingAction: { tool: state.prepared.tool, input: state.prepared.input, summary: state.prepared.summary } as object }),
        },
      }),
    );
  }

  private async noPermission(conversationId: string, staff: StaffMember) {
    const recent = await this.uow.read((tx) =>
      tx.message.findFirst({ where: { conversationId, sentBy: STAFF_SENDER, sentAt: { gt: new Date(Date.now() - NO_PERMISSION_NOTICE_MS) } }, select: { id: true } }),
    );
    if (recent) return;
    await this.send(conversationId, `Hola ${staff.fullName.split(' ')[0]}. Tu usuario (${staff.roleName}) no tiene habilitado darle órdenes a la IA por WhatsApp. Si lo necesitás, pedíselo a un dueño.`);
  }

  private async send(conversationId: string, text: string) {
    const ctx = RequestContextStore.get();
    const conv = await this.uow.read((tx) => tx.conversation.findFirstOrThrow({ where: { id: conversationId }, include: { account: true } }));
    if (!conv.windowExpiresAt || conv.windowExpiresAt < new Date()) return;
    const body = text.slice(0, 4000);
    const waId = await this.whatsapp.sendText(conv.account, conv.waContactId, body);
    const now = new Date();
    await this.uow.run(async (tx) => {
      await tx.message.create({
        data: { tenantId: ctx.tenantId, conversationId, waMessageId: waId, direction: 'OUTBOUND', type: 'text', body, status: 'SENT', sentBy: STAFF_SENDER, sentAt: now },
      });
      // Es un chat interno: no queda como "sin leer" en la bandeja.
      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now, unreadCount: 0 } });
    });
  }

  private async isLatest(conversationId: string, messageId: string): Promise<boolean> {
    const latest = await this.uow.read((tx) =>
      tx.message.findFirst({ where: { conversationId }, orderBy: { sentAt: 'desc' }, select: { id: true, direction: true, sentAt: true } }),
    );
    if (!latest || latest.direction !== 'INBOUND') return false;
    if (latest.id === messageId) return true;
    const mine = await this.uow.read((tx) => tx.message.findUnique({ where: { id: messageId }, select: { sentAt: true } }));
    return !!mine && latest.sentAt <= mine.sentAt;
  }

  private async waitForTranscript(messageId: string) {
    const until = Date.now() + TRANSCRIPT_WAIT_MS;
    while (Date.now() < until) {
      const m = await this.uow.read((tx) => tx.message.findUnique({ where: { id: messageId }, select: { transcript: true } }));
      if (m?.transcript) return;
      await sleep(2_000);
    }
  }
}

const CONFIRM_TOOLS: Anthropic.Tool[] = [
  {
    name: 'confirmar_accion',
    description: 'Ejecuta la acción delicada que está esperando confirmación. Usala solo si en su último mensaje dijo que sí.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  } as Anthropic.Tool,
  {
    name: 'descartar_accion',
    description: 'Descarta la acción delicada que está esperando confirmación (dijo que no, o pidió otra cosa).',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  } as Anthropic.Tool,
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
