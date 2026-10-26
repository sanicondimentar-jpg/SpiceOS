import { DomainEvent } from './domain-event';

/** Base de agregados: acumula eventos que el repositorio guarda en el outbox en la misma transacción. */
export abstract class AggregateRoot {
  private readonly pending: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.pending.push(event);
  }

  pullEvents(): DomainEvent[] {
    return this.pending.splice(0, this.pending.length);
  }
}
