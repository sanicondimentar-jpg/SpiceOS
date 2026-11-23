import { Injectable } from '@nestjs/common';
import type { AiInstructionInput, AiInstructionView, AiOrderAction, AiOrderListQuery, AiOrderStatus, AiOrderView } from '@spiceos/contracts';
import { NotFoundError, BusinessRuleError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { UnitOfWork } from '../../shared/unit-of-work';
import { instructionActive } from './domain/staff';

/** Registro de órdenes a la IA e indicaciones vigentes para el asistente de ventas. */
@Injectable()
export class AiOrdersService {
  constructor(private readonly uow: UnitOfWork) {}

  list(query: AiOrderListQuery): Promise<AiOrderView[]> {
    return this.uow.read(async (tx) => {
      const rows = await tx.aiOrder.findMany({
        where: query.userId ? { userId: query.userId } : {},
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      });
      const names = await userNames(tx, rows.map((r) => r.userId));
      return rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        user: { id: r.userId, name: names.get(r.userId) ?? 'Usuario' },
        request: r.request,
        reply: r.reply,
        status: r.status as AiOrderStatus,
        actions: (r.actions as unknown as AiOrderAction[]) ?? [],
        pending: r.pendingAction ? { summary: String((r.pendingAction as { summary?: string }).summary ?? '') } : null,
        confirmedAt: r.confirmedAt?.toISOString() ?? null,
      }));
    });
  }

  instructions(all = false): Promise<AiInstructionView[]> {
    return this.uow.read(async (tx) => {
      const rows = await tx.aiInstruction.findMany({ orderBy: { createdAt: 'desc' }, take: all ? 200 : 100, ...(all ? {} : { where: { revokedAt: null } }) });
      const now = new Date();
      const names = await userNames(tx, rows.flatMap((r) => [r.createdBy, ...(r.revokedBy ? [r.revokedBy] : [])]));
      return rows
        .map((r) => ({
          id: r.id,
          text: r.text,
          until: r.until?.toISOString().slice(0, 10) ?? null,
          createdAt: r.createdAt.toISOString(),
          createdBy: names.get(r.createdBy) ?? 'Usuario',
          source: r.source === 'web' ? ('web' as const) : ('whatsapp' as const),
          active: instructionActive(r, now),
          revokedAt: r.revokedAt?.toISOString() ?? null,
          revokedBy: r.revokedBy ? (names.get(r.revokedBy) ?? 'Usuario') : null,
        }))
        .filter((r) => all || r.active);
    });
  }

  addInstruction(input: AiInstructionInput, source: 'web' | 'whatsapp') {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const row = await tx.aiInstruction.create({
        data: {
          tenantId: ctx.tenantId,
          text: input.text.trim(),
          until: input.until ? new Date(`${input.until}T00:00:00Z`) : null,
          source,
          createdBy: ctx.onBehalfOf ?? ctx.userId,
        },
      });
      scope.auditLog({ action: 'ai_instruction.create', entityType: 'ai_instruction', entityId: row.id, after: { text: row.text, until: input.until ?? null, source } });
      return { id: row.id };
    });
  }

  revokeInstruction(id: string) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const row = await tx.aiInstruction.findFirst({ where: { id } });
      if (!row) throw new NotFoundError('Indicación', id);
      if (row.revokedAt) throw new BusinessRuleError('Esa indicación ya estaba cortada');
      await tx.aiInstruction.update({ where: { id }, data: { revokedAt: new Date(), revokedBy: ctx.onBehalfOf ?? ctx.userId } });
      scope.auditLog({ action: 'ai_instruction.revoke', entityType: 'ai_instruction', entityId: id, before: { text: row.text } });
      return { id };
    });
  }

  /** Textos vigentes, para el prompt del asistente de ventas. */
  static async activeTexts(tx: Tx): Promise<string[]> {
    const rows = await tx.aiInstruction.findMany({ where: { revokedAt: null }, orderBy: { createdAt: 'asc' }, take: 30 });
    const now = new Date();
    return rows.filter((r) => instructionActive(r, now)).map((r) => r.text);
  }
}

async function userNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const users = await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}
