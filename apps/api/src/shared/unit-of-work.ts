import { Injectable } from '@nestjs/common';
import type { AggregateRoot } from './domain/aggregate-root';
import { AuditEntry, AuditService } from './audit/audit.service';
import { OutboxService } from './outbox/outbox.service';
import { PrismaService, Tx } from './prisma/prisma.service';

/**
 * Unidad de trabajo de un caso de uso: una transacción con tenant fijado,
 * auditoría y eventos de dominio guardados atómicamente con el cambio.
 */
@Injectable()
export class UnitOfWork {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  run<T>(fn: (tx: Tx, uow: UowScope) => Promise<T>): Promise<T> {
    return this.prisma.tx(async (tx) => {
      const scope = new UowScope();
      const result = await fn(tx, scope);
      for (const entry of scope.audits) await this.audit.record(tx, entry);
      await this.outbox.add(tx, scope.aggregates.flatMap((a) => a.pullEvents()));
      return result;
    });
  }

  read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.tx(fn);
  }
}

export class UowScope {
  readonly audits: AuditEntry[] = [];
  readonly aggregates: AggregateRoot[] = [];

  track(aggregate: AggregateRoot): void {
    this.aggregates.push(aggregate);
  }

  auditLog(entry: AuditEntry): void {
    this.audits.push(entry);
  }
}
