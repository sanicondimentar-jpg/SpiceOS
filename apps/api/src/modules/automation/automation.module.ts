import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TasksModule } from '../tasks/tasks.module';
import { AutomationController } from './automation.controller';
import { RuleEngineService } from './rule-engine.service';

@Module({
  imports: [CqrsModule, TasksModule],
  controllers: [AutomationController],
  providers: [RuleEngineService],
})
export class AutomationModule {}
