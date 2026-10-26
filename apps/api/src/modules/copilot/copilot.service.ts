import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import type { CopilotMessageInput } from '@spiceos/contracts';
import { AiToolRegistry } from '../../shared/ai/ai-tool.registry';
import { LlmService } from '../../shared/ai/llm.service';
import { NotFoundError, BusinessRuleError } from '../../shared/domain/errors';
import { UnitOfWork } from '../../shared/unit-of-work';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { AGENT_PROMPTS } from './agents';

const MAX_ITERATIONS = 12;
// Fallback del servidor ante rechazos de los clasificadores de seguridad (ver docs de la API de Claude).
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface CopilotReply {
  sessionId: string;
  text: string;
  pendingConfirmations: { toolCallId: string; tool: string; input: unknown }[];
  toolsUsed: string[];
}

/**
 * Copiloto: bucle agéntico sobre la API de Claude con las tools del sistema.
 * El historial es append-only (se reenvía tal cual, incluidos los bloques de thinking).
 * Cada ejecución queda en agent_runs / tool_calls para auditoría y control de costo.
 */
@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly tools: AiToolRegistry,
    private readonly uow: UnitOfWork,
  ) {}

  async chat(input: CopilotMessageInput): Promise<CopilotReply> {
    const ctx = RequestContextStore.get();
    const agent = input.agent;
    const session = await this.loadOrCreateSession(input);
    const history = await this.uow.read((tx) =>
      tx.copilotMessage.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' } }),
    );
    const messages: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content as unknown as Anthropic.MessageParam['content'],
    }));

    const userContent = this.withScreenContext(input);
    messages.push({ role: 'user', content: userContent });
    await this.persist(session.id, 'user', userContent);

    const available = this.tools.forAgent(agent);
    const toolDefs = this.tools.toAnthropicTools(available);
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: AGENT_PROMPTS[agent], cache_control: { type: 'ephemeral' } },
    ];

    const run = await this.uow.run((tx) =>
      tx.agentRun.create({
        data: { tenantId: ctx.tenantId, agent, sessionId: session.id, trigger: 'user', onBehalfOf: ctx.userId, model: this.llm.model },
      }),
    );

    const usage = { input: 0, output: 0 };
    const pendingConfirmations: CopilotReply['pendingConfirmations'] = [];
    const toolsUsed: string[] = [];
    let finalText = '';

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const response = await this.llm.client.messages.create(
          {
            model: this.llm.model,
            max_tokens: 16000,
            system,
            tools: toolDefs,
            messages,
            output_config: { effort: 'medium' },
            fallbacks: 'default',
          } as unknown as Anthropic.MessageCreateParamsNonStreaming,
          { headers: { 'anthropic-beta': FALLBACK_BETA } },
        );
        usage.input += response.usage.input_tokens;
        usage.output += response.usage.output_tokens;

        if (response.stop_reason === 'refusal') {
          finalText = 'No puedo ayudar con esa solicitud.';
          break;
        }

        messages.push({ role: 'assistant', content: response.content });
        await this.persist(session.id, 'assistant', response.content);

        if (response.stop_reason === 'pause_turn') continue;
        if (response.stop_reason !== 'tool_use') {
          finalText = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('\n');
          if (response.stop_reason === 'max_tokens') finalText += '\n\n(Respuesta cortada por longitud)';
          break;
        }

        const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        const results = await Promise.all(
          toolUses.map((use) => this.runTool(run.id, agent, use, pendingConfirmations, toolsUsed)),
        );
        messages.push({ role: 'user', content: results });
        await this.persist(session.id, 'user', results);
      }

      await this.finishRun(run.id, 'SUCCEEDED', usage, pendingConfirmations.length > 0);
      return { sessionId: session.id, text: finalText, pendingConfirmations, toolsUsed };
    } catch (err) {
      await this.finishRun(run.id, 'FAILED', usage, false, String(err));
      throw err;
    }
  }

  /** El usuario aprueba una acción propuesta por el copiloto (ej. enviar un WhatsApp). */
  async confirm(toolCallId: string): Promise<unknown> {
    const ctx = RequestContextStore.get();
    const call = await this.uow.read((tx) => tx.toolCall.findUnique({ where: { id: toolCallId }, include: { run: true } }));
    if (!call) throw new NotFoundError('Acción', toolCallId);
    if (call.approvedBy) throw new BusinessRuleError('La acción ya fue confirmada');
    if (call.run.onBehalfOf !== ctx.userId) throw new BusinessRuleError('Solo quien pidió la acción puede confirmarla');
    const output = await this.tools.execute(call.tool, call.input, call.run.agent);
    await this.uow.run((tx) =>
      tx.toolCall.update({ where: { id: toolCallId }, data: { approvedBy: ctx.userId, output: json(output) } }),
    );
    return output;
  }

  sessions() {
    const { userId } = RequestContextStore.get();
    return this.uow.read((tx) =>
      tx.copilotSession.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, title: true, createdAt: true } }),
    );
  }

  private async runTool(
    runId: string,
    agent: string,
    use: Anthropic.ToolUseBlock,
    pending: CopilotReply['pendingConfirmations'],
    used: string[],
  ): Promise<Anthropic.ToolResultBlockParam> {
    const started = Date.now();
    const tool = this.tools.get(use.name);
    used.push(use.name);

    if (tool?.options.requiresConfirmation) {
      const call = await this.uow.run((tx) =>
        tx.toolCall.create({ data: { runId, tool: use.name, input: json(use.input), isWrite: true } }),
      );
      pending.push({ toolCallId: call.id, tool: use.name, input: use.input });
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: 'Acción preparada y mostrada al usuario para que la confirme. No la repitas; avisale que debe confirmarla.',
      };
    }

    try {
      const output = await this.tools.execute(use.name, use.input, agent);
      await this.uow.run((tx) =>
        tx.toolCall.create({
          data: { runId, tool: use.name, input: json(use.input), output: json(output), isWrite: !!tool?.options.write, durationMs: Date.now() - started },
        }),
      );
      return { type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(output, decimalReplacer).slice(0, 60_000) };
    } catch (err) {
      this.logger.warn(`Tool ${use.name} falló: ${String(err)}`);
      return { type: 'tool_result', tool_use_id: use.id, is_error: true, content: String((err as Error).message ?? err) };
    }
  }

  private async loadOrCreateSession(input: CopilotMessageInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx) => {
      if (input.sessionId) {
        const s = await tx.copilotSession.findFirst({ where: { id: input.sessionId, userId: ctx.userId } });
        if (!s) throw new NotFoundError('Sesión', input.sessionId);
        return s;
      }
      return tx.copilotSession.create({
        data: { tenantId: ctx.tenantId, userId: ctx.userId, title: input.message.slice(0, 80), context: json(input.context ?? {}) },
      });
    });
  }

  /** Inyecta desde qué pantalla y entidad se abrió el copiloto, para que "este cliente" tenga sentido. */
  private withScreenContext(input: CopilotMessageInput): string {
    const c = input.context;
    if (!c?.entityType) return input.message;
    return `[Contexto: pantalla ${c.screen ?? '-'}, ${c.entityType} ${c.entityId ?? ''}]\n${input.message}`;
  }

  private persist(sessionId: string, role: string, content: unknown) {
    return this.uow.run((tx) => tx.copilotMessage.create({ data: { sessionId, role, content: json(content) } }));
  }

  private finishRun(id: string, status: string, usage: { input: number; output: number }, awaiting: boolean, error?: string) {
    return this.uow.run((tx) =>
      tx.agentRun.update({
        where: { id },
        data: {
          status: awaiting ? 'AWAITING_APPROVAL' : status,
          inputTokens: usage.input,
          outputTokens: usage.output,
          // Claude Opus 5.5: USD 4 / 20 por millón de tokens de entrada / salida
          costUsd: (usage.input * 4 + usage.output * 20) / 1_000_000,
          finishedAt: new Date(),
          error,
        },
      }),
    );
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null, decimalReplacer)) as Prisma.InputJsonValue;
}

/** Prisma Decimal y BigInt no son JSON nativos. */
function decimalReplacer(_key: string, value: unknown) {
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object' && 'toFixed' in value && 'd' in value) return Number(value);
  return value;
}
