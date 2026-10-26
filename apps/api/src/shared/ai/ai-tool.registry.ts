import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type Anthropic from '@anthropic-ai/sdk';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AI_TOOL_KEY, AgentName, AiToolOptions } from './ai-tool.decorator';
import { assertPermission } from '../auth/permissions.guard';
import { RequestContextStore } from '../tenancy/request-context';

// zod-to-json-schema tiene tipos recursivos muy profundos; se encapsula en una función sin genéricos.
const toJsonSchema = (schema: ZodTypeAny): Anthropic.Tool.InputSchema =>
  (zodToJsonSchema as (s: unknown, o: unknown) => unknown)(schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Anthropic.Tool.InputSchema;

export interface RegisteredTool {
  options: AiToolOptions;
  invoke: (input: unknown) => Promise<unknown>;
}

/** Descubre al arrancar todos los métodos marcados con @AiTool en cualquier módulo. */
@Injectable()
export class AiToolRegistry implements OnModuleInit {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit() {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object') continue;
      const proto = Object.getPrototypeOf(instance);
      for (const method of this.scanner.getAllMethodNames(proto)) {
        const fn = instance[method] as (...args: unknown[]) => Promise<unknown>;
        const options = this.reflector.get<AiToolOptions | undefined>(AI_TOOL_KEY, fn);
        if (!options) continue;
        if (this.tools.has(options.name)) throw new Error(`Tool IA duplicada: ${options.name}`);
        this.tools.set(options.name, { options, invoke: (input) => fn.call(instance, input) });
      }
    }
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /** Tools visibles para un agente, filtradas por los permisos del usuario actual. */
  forAgent(agent: AgentName | 'auto'): RegisteredTool[] {
    const perms = RequestContextStore.get().permissions;
    return [...this.tools.values()].filter(
      (t) =>
        (agent === 'auto' || !t.options.agents?.length || t.options.agents.includes(agent)) &&
        t.options.permissions.every((p) => perms.has(p)),
    );
  }

  toAnthropicTools(tools: RegisteredTool[]): Anthropic.Tool[] {
    return tools
      .slice()
      .sort((a, b) => a.options.name.localeCompare(b.options.name)) // orden estable: no invalida el cache de prompt
      .map((t) => ({
        name: t.options.name,
        description: t.options.description,
        input_schema: toJsonSchema(t.options.input),
      }));
  }

  /** Valida la entrada con zod, re-chequea permisos y ejecuta como acción del agente. */
  async execute(name: string, rawInput: unknown, agent: string): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool desconocida: ${name}`);
    const input = tool.options.input.parse(rawInput);
    return RequestContextStore.asAgent(agent, async () => {
      assertPermission(...tool.options.permissions);
      return tool.invoke(input);
    });
  }
}
