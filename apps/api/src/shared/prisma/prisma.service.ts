import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { RequestContextStore } from '../tenancy/request-context';
import { env } from '../config/env';

export type Tx = Prisma.TransactionClient;

/**
 * Acceso a datos con aislamiento por empresa.
 * Toda operación corre dentro de una transacción que fija app.tenant_id,
 * y las políticas RLS de PostgreSQL filtran el resto.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ datasourceUrl: env().DATABASE_URL });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Transacción con el tenant del contexto actual. */
  tx<T>(fn: (tx: Tx) => Promise<T>, tenantId = RequestContextStore.get().tenantId): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }
}

/** Cliente con BYPASSRLS para procesos de sistema (outbox relay, scheduler). Nunca para requests HTTP. */
@Injectable()
export class SystemPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ datasourceUrl: env().SYSTEM_DATABASE_URL });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
