import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueryBus } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { ALL_PERMISSIONS, ConditionNode, EventEnvelope, RuleAction, ruleActionSchema } from '@spiceos/contracts';
import { Prisma } from '@prisma/client';
import { EventBusService } from '../../shared/messaging/event-bus.service';
import { SystemPrismaService } from '../../shared/prisma/prisma.service';
import { UnitOfWork } from '../../shared/unit-of-work';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { isScheduler, isWorker } from '../../shared/process-role';
import { evaluate, render } from './conditions';
import { TasksService } from '../tasks/tasks.service';
import { FindInactiveCustomersQuery, InactiveCustomerRow } from '../crm/application/queries/customer.queries';
import { CronExpressionParser } from './cron';

/**
 * Motor de reglas: SI <evento/horario> Y <condiciones> ENTONCES <acciones>.
 * Escucha todos los eventos (#). Idempotente por (regla, evento).
 */
@Injectable()
export class RuleEngineService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RuleEngineService.name);

  constructor(
    private readonly bus: EventBusService,
    private readonly uow: UnitOfWork,
    private readonly system: SystemPrismaService,
    private readonly tasks: TasksService,
    private readonly queries: QueryBus,
  ) {}

  async onApplicationBootstrap() {
    if (!isWorker()) return;
    await this.bus.subscribe('automation.rules', ['#'], (e) => this.onEvent(e));
  }

  async onEvent(event: EventEnvelope): Promise<void> {
    if (event.type === 'rule.fired' || event.type === 'task.created') return; // evita cascadas
    const rules = await this.uow.read((tx) =>
      tx.automationRule.findMany({ where: { isActive: true, triggerType: 'EVENT', eventType: event.type } }),
    );
    for (const rule of rules) await this.apply(rule, event, event.id);
  }

  /** Reglas por horario: el scheduler las dispara y genera un "evento sintético" por cada fila que cumpla. */
  @Cron('0 * * * *')
  async runScheduled(): Promise<void> {
    if (!isScheduler()) return;
    const rules = await this.system.automationRule.findMany({ where: { isActive: true, triggerType: 'SCHEDULE' } });
    for (const rule of rules) {
      if (!rule.schedule || !CronExpressionParser.matchesHour(rule.schedule, new Date())) continue;
      await RequestContextStore.run(systemCtx(rule.tenantId), () => this.runScheduledRule(rule));
    }
  }

  private async runScheduledRule(rule: RuleRow) {
    // Fuente de datos de reglas por horario: hoy clientes inactivos; se amplía con más "detectores".
    const days = Number((rule.conditions as { days?: number }).days ?? 60);
    const rows: InactiveCustomerRow[] = await this.queries.execute(new FindInactiveCustomersQuery(days));
    const today = new Date().toISOString().slice(0, 10);
    for (const row of rows) {
      const synthetic: EventEnvelope = {
        id: `${rule.id}:${row.id}:${today}`,
        type: 'customer.inactive_detected',
        tenantId: rule.tenantId,
        aggregateType: 'customer',
        aggregateId: row.id,
        occurredAt: new Date().toISOString(),
        payload: { customerId: row.id, customerName: row.legal_name, ownerId: row.owner_id, daysInactive: row.days_inactive, revenue12m: row.revenue_12m },
      };
      await this.apply(rule, synthetic, synthetic.id, true);
    }
  }

  private async apply(rule: RuleRow, event: EventEnvelope, eventId: string, skipConditions = false) {
    const already = await this.uow.read((tx) => tx.ruleExecution.findUnique({ where: { ruleId_eventId: { ruleId: rule.id, eventId } } }));
    if (already) return;

    const matched = skipConditions || evaluate(rule.conditions as unknown as ConditionNode, event);
    const results: unknown[] = [];
    let error: string | undefined;
    if (matched) {
      try {
        const actions = (rule.actions as unknown[]).map((a) => ruleActionSchema.parse(a));
        for (const action of actions) results.push(await RequestContextStore.run(ruleCtx(rule), () => this.execute(action, event)));
      } catch (err) {
        error = String(err);
        this.logger.error(`Regla ${rule.name} falló: ${error}`);
      }
    }
    await this.uow.run((tx) =>
      tx.ruleExecution.create({
        data: { ruleId: rule.id, eventId, matched, result: results as Prisma.InputJsonValue, error },
      }),
    );
  }

  private async execute(action: RuleAction, event: EventEnvelope): Promise<unknown> {
    const p = event.payload as Record<string, unknown>;
    switch (action.type) {
      case 'create_task':
        return this.tasks.create({
          title: render(action.params.title, event),
          assigneeId: action.params.assignTo === 'owner' ? ((p.ownerId as string) ?? null) : action.params.assignTo,
          entityType: event.aggregateType,
          entityId: event.aggregateId,
          dueAt: new Date(Date.now() + action.params.dueInHours * 3600_000),
          priority: action.params.priority,
          origin: RequestContextStore.get().actor,
        });
      case 'notify':
        return this.tasks.notifyRole(action.params.role, render(action.params.title, event), render(action.params.body, event));
      case 'create_opportunity':
        return this.uow.run(async (tx) => {
          const stage = await tx.pipelineStage.findFirst({ where: { name: action.params.stage } });
          if (!stage) throw new Error(`Etapa ${action.params.stage} no existe`);
          return tx.opportunity.create({
            data: {
              tenantId: event.tenantId,
              customerId: (p.customerId as string) ?? null,
              leadId: (p.leadId as string) ?? null,
              stageId: stage.id,
              title: render(action.params.title, event),
              source: 'rule',
            },
          });
        });
      case 'run_agent':
        // Fase 2: encola una ejecución del agente con la instrucción y el evento como contexto.
        return { queued: action.params.agent };
    }
  }
}

type RuleRow = Awaited<ReturnType<SystemPrismaService['automationRule']['findFirstOrThrow']>>;

function systemCtx(tenantId: string) {
  return {
    tenantId,
    userId: '00000000-0000-0000-0000-000000000000',
    actor: 'system:scheduler',
    actorType: 'SYSTEM' as const,
    roleKey: 'system',
    permissions: new Set(ALL_PERMISSIONS),
    branchScope: [],
    maxDiscount: 0,
    correlationId: randomUUID(),
  };
}

function ruleCtx(rule: RuleRow) {
  return { ...systemCtx(rule.tenantId), actor: `rule:${rule.id}`, actorType: 'RULE' as const };
}
