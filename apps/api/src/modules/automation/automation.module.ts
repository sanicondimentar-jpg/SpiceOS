import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TasksModule } from '../tasks/tasks.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ReceivablesModule } from '../receivables/receivables.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AutomationController } from './automation.controller';
import { RuleEngineService } from './rule-engine.service';

@Module({
  imports: [CqrsModule, TasksModule, AnalyticsModule, ReceivablesModule],
  controllers: [AutomationController, AlertsController],
  providers: [RuleEngineService, AlertsService],
})
export class AutomationModule {}
