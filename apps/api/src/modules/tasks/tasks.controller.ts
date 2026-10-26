import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS } from '@spiceos/contracts';
import { Injectable } from '@nestjs/common';
import { AiTool } from '../../shared/ai/ai-tool.decorator';
import { ZodPipe } from '../../shared/http/zod-validation.pipe';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { TasksService } from './tasks.service';

const createTaskSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  assigneeId: z.string().uuid().nullable().default(null),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
});

@ApiTags('Tareas')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('mine')
  mine() {
    return this.tasks.mine();
  }

  @Post()
  create(@Body(new ZodPipe(createTaskSchema)) body: z.infer<typeof createTaskSchema>) {
    return this.tasks.create(body);
  }

  @Post(':id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.complete(id);
  }
}

@Injectable()
export class TasksAiTools {
  constructor(private readonly tasks: TasksService) {}

  @AiTool({
    name: 'tasks_create',
    description: 'Crea una tarea de seguimiento (llamar, visitar, enviar muestra) asignada al usuario o a otra persona, opcionalmente vinculada a un cliente.',
    input: createTaskSchema,
    permissions: [PERMISSIONS.crm.customerRead],
    write: true,
  })
  create(input: z.infer<typeof createTaskSchema>) {
    const ctx = RequestContextStore.get();
    return this.tasks.create({ ...input, assigneeId: input.assigneeId ?? ctx.onBehalfOf ?? null, origin: ctx.actor });
  }
}
