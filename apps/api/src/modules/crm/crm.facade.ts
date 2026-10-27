import { Inject, Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { NotFoundError } from '../../shared/domain/errors';
import type { Tx } from '../../shared/prisma/prisma.service';
import { CUSTOMER_REPOSITORY, CustomerRepository } from './domain/customer.repository';
import { phoneVariants } from './domain/customer';
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

  createProspect(name: string, phone: string): Promise<{ id: string; code: string }> {
    return this.commands.execute(
      new CreateCustomerCommand({ legalName: name, phone, source: 'whatsapp', paymentTermsDays: 0, tags: ['whatsapp'] }),
    );
  }
}
