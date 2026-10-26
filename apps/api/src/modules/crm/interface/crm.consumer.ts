import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { EventBusService } from '../../../shared/messaging/event-bus.service';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { isWorker } from '../../../shared/process-role';

/** Proyecciones del CRM a partir de eventos de otros módulos (el CRM no lee tablas ajenas en línea). */
@Injectable()
export class CrmConsumer implements OnApplicationBootstrap {
  constructor(
    private readonly bus: EventBusService,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap() {
    if (!isWorker()) return;
    await this.bus.subscribe('crm.projections', ['order.confirmed'], async (event) => {
      const { customerId, confirmedAt } = event.payload as { customerId: string; confirmedAt: string };
      await this.prisma.tx(
        (tx) =>
          tx.customer.updateMany({
            where: { id: customerId, OR: [{ lastOrderAt: null }, { lastOrderAt: { lt: new Date(confirmedAt) } }] },
            data: { lastOrderAt: new Date(confirmedAt), status: 'ACTIVE' },
          }),
        event.tenantId,
      );
    });
  }
}
