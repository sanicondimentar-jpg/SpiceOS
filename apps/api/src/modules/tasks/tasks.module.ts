import { Module } from '@nestjs/common';
import { TasksAiTools, TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService, TasksAiTools],
  exports: [TasksService],
})
export class TasksModule {}
