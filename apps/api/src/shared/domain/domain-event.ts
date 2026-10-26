import { randomUUID } from 'node:crypto';
import type { EventType } from '@spiceos/contracts';

export class DomainEvent<T = Record<string, unknown>> {
  readonly id = randomUUID();
  readonly occurredAt = new Date();

  constructor(
    readonly type: EventType,
    readonly aggregateType: string,
    readonly aggregateId: string,
    readonly payload: T,
  ) {}
}
