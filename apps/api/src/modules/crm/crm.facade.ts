import { Inject, Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { NotFoundError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import type { UowScope } from '../../shared/unit-of-work';
import { RequestContextStore } from '../../shared/tenancy/request-context';
import { CUSTOMER_REPOSITORY, CustomerRepository } from './domain/customer.repository';
import { Customer, phoneVariants } from './domain/customer';
import { CreateCustomerCommand } from './application/commands/create-customer.command';

/** API pública del módulo CRM para otros módulos (WhatsApp, Pedidos). Nadie más toca sus tablas. */
@Injectable()
export class CrmFacade {
  constructor(
    private readonly commands: CommandBus,
    @Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
  ) {}

  async findIdByPhone(tx: Tx, phone: string): Promise<string | null> {
    const variants = phoneVariants(phone);
    if (!variants.length) return null;
    return (await this.customers.findByPhone(tx, variants))?.id ?? null;
  }

  async assertCanOrder(tx: Tx, customerId: string): Promise<{ priceListId: string | null; paymentTermsDays: number }> {
    const customer = await this.customers.findById(tx, customerId);
    if (!customer) throw new NotFoundError('Cliente', customerId);
    customer.assertCanOrder();
    const s = customer.snapshot();
    return { priceListId: s.priceListId ?? null, paymentTermsDays: s.paymentTermsDays };
  }

  /** Cliente prospecto creado por un pedido de la web, dentro de la misma transacción que el pedido. */
  async createWebProspect(tx: Tx, scope: UowScope, input: { name: string; phone: string; priceListId: string | null }): Promise<{ id: string }> {
    const ctx = RequestContextStore.get();
    const customer = Customer.create({
      tenantId: ctx.tenantId,
      code: await this.customers.nextCode(tx),
      legalName: input.name,
      phone: input.phone,
      priceListId: input.priceListId,
      source: 'web',
      paymentTermsDays: 0,
      tags: ['web'],
    });
    await this.customers.insert(tx, customer, ctx.actor);
    scope.track(customer);
    scope.auditLog({ action: 'customer.create', entityType: 'customer', entityId: customer.id, after: customer.snapshot() });
    return { id: customer.id };
  }

  /** Al descartar un pedido web, borra el prospecto que creó si no tiene otros pedidos. */
  async discardWebProspect(tx: Tx, scope: UowScope, customerId: string, orderId: string): Promise<boolean> {
    const other = await tx.salesOrder.count({ where: { customerId, id: { not: orderId } } });
    if (other) return false;
    const res = await tx.customer.updateMany({ where: { id: customerId, status: 'PROSPECT', source: 'web', deletedAt: null }, data: { deletedAt: new Date() } });
    if (res.count) scope.auditLog({ action: 'customer.delete', entityType: 'customer', entityId: customerId, after: { reason: 'pedido web descartado' } });
    return res.count > 0;
  }

  createProspect(name: string, phone: string): Promise<{ id: string; code: string }> {
    return this.commands.execute(
      new CreateCustomerCommand({ legalName: name, phone, source: 'whatsapp', paymentTermsDays: 0, tags: ['whatsapp'] }),
    );
  }
}
