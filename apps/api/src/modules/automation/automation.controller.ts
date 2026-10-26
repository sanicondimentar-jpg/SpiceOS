import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { AutomationRuleInput, PERMISSIONS, automationRuleSchema } from '@spiceos/contracts';
import { RequirePermissions } from '../../shared/auth/decorators';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { UnitOfWork } from '../../shared/unit-of-work';
import { RequestContextStore } from '../../shared/tenancy/request-context';

@ApiTags('Automatizaciones')
@ApiBearerAuth()
@Controller('automation/rules')
export class AutomationController {
  constructor(private readonly uow: UnitOfWork) {}

  @Get()
  @RequirePermissions(PERMISSIONS.automation.read)
  list() {
    return this.uow.read((tx) =>
      tx.automationRule.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { executions: true } } } }),
    );
  }

  @Post()
  @RequirePermissions(PERMISSIONS.automation.write)
  create(@Body(new ZodPipe(automationRuleSchema)) body: AutomationRuleInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const rule = await tx.automationRule.create({
        data: {
          ...body,
          tenantId: ctx.tenantId,
          conditions: body.conditions as Prisma.InputJsonValue,
          actions: body.actions as Prisma.InputJsonValue,
          createdBy: ctx.actor,
        },
      });
      scope.auditLog({ action: 'automation.rule.create', entityType: 'automation_rule', entityId: rule.id, after: rule });
      return rule;
    });
  }

  @Patch(':id/toggle')
  @RequirePermissions(PERMISSIONS.automation.write)
  toggle(@Param('id', ParseUUIDPipe) id: string) {
    return this.uow.run(async (tx, scope) => {
      const rule = await tx.automationRule.findUniqueOrThrow({ where: { id } });
      scope.auditLog({ action: 'automation.rule.toggle', entityType: 'automation_rule', entityId: id, after: { isActive: !rule.isActive } });
      return tx.automationRule.update({ where: { id }, data: { isActive: !rule.isActive } });
    });
  }

  @Get(':id/executions')
  @RequirePermissions(PERMISSIONS.automation.read)
  executions(@Param('id', ParseUUIDPipe) id: string) {
    return this.uow.read((tx) => tx.ruleExecution.findMany({ where: { ruleId: id }, orderBy: { executedAt: 'desc' }, take: 100 }));
  }
}
