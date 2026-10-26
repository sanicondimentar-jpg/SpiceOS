import { AsyncLocalStorage } from 'node:async_hooks';
import type { PermissionKey } from '@spiceos/contracts';

export interface RequestContext {
  tenantId: string;
  userId: string; // id interno (users.id)
  actor: string; // userId, "agent:<nombre>" o "rule:<id>"
  actorType: 'USER' | 'AGENT' | 'RULE' | 'SYSTEM' | 'INTEGRATION';
  onBehalfOf?: string;
  roleKey: string;
  permissions: Set<PermissionKey>;
  branchScope: string[]; // vacío = todas las sucursales
  maxDiscount: number;
  correlationId: string;
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext {
    const ctx = storage.getStore();
    if (!ctx) throw new Error('Sin contexto de request: toda operación de negocio requiere tenant');
    return ctx;
  },
  tryGet(): RequestContext | undefined {
    return storage.getStore();
  },
  /** Ejecuta fn como un agente IA en nombre del usuario actual (misma empresa, mismos permisos). */
  asAgent<T>(agent: string, fn: () => T): T {
    const base = this.get();
    return storage.run(
      { ...base, actor: `agent:${agent}`, actorType: 'AGENT', onBehalfOf: base.userId },
      fn,
    );
  },
};
