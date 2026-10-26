import { Injectable } from '@nestjs/common';
import type { TaskPriority } from '@prisma/client';
import { UnitOfWork } from '../../shared/unit-of-work';
import { AggregateRoot } from '../../shared/domain/aggregate-root';
import { DomainEvent } from '../../shared/domain/domain-event';
import { RequestContextStore } from '../../shared/tenancy/request-context';

class TaskEvents extends AggregateRoot {
  emit(e: DomainEvent) {
    this.record(e);
  }
}

export interface NewTask {
  title: string;
  description?: string;
  assigneeId: string | null;
  entityType?: string;
  entityId?: string;
  dueAt?: Date;
  priority?: TaskPriority;
  origin?: string;
}

@Injectable()
export class TasksService {
  constructor(private readonly uow: UnitOfWork) {}

  create(input: NewTask) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const task = await tx.task.create({
        data: { ...input, tenantId: ctx.tenantId, origin: input.origin ?? 'manual', createdBy: ctx.actor },
      });
      if (task.assigneeId) {
        await tx.notification.create({
          data: { tenantId: ctx.tenantId, userId: task.assigneeId, title: 'Nueva tarea', body: task.title, link: `/tasks/${task.id}` },
        });
      }
      const events = new TaskEvents();
      events.emit(new DomainEvent('task.created', 'task', task.id, { taskId: task.id, assigneeId: task.assigneeId, origin: task.origin }));
      scope.track(events);
      return { id: task.id };
    });
  }

  notifyRole(roleKey: string, title: string, body: string) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx) => {
      const members = await tx.membership.findMany({ where: { isActive: true, role: { key: roleKey } }, select: { userId: true } });
      await tx.notification.createMany({ data: members.map((m) => ({ tenantId: ctx.tenantId, userId: m.userId, title, body })) });
      return { notified: members.length };
    });
  }

  mine() {
    const { userId } = RequestContextStore.get();
    return this.uow.read((tx) =>
      tx.task.findMany({ where: { assigneeId: userId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: [{ dueAt: 'asc' }] }),
    );
  }

  complete(id: string) {
    return this.uow.run((tx) => tx.task.update({ where: { id }, data: { status: 'DONE', completedAt: new Date() } }));
  }
}
