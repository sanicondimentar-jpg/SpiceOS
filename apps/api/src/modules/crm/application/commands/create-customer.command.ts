import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { CreateCustomerInput } from '@spiceos/contracts';
import { UnitOfWork } from '../../../../shared/unit-of-work';
import { RequestContextStore } from '../../../../shared/tenancy/request-context';
import { ConflictError } from '../../../../shared/domain/errors';
import { Customer } from '../../domain/customer';
import { CUSTOMER_REPOSITORY, CustomerRepository } from '../../domain/customer.repository';

export class CreateCustomerCommand {
  constructor(readonly input: CreateCustomerInput) {}
}

@CommandHandler(CreateCustomerCommand)
export class CreateCustomerHandler implements ICommandHandler<CreateCustomerCommand, { id: string; code: string }> {
  constructor(
    private readonly uow: UnitOfWork,
    @Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
  ) {}

  execute({ input }: CreateCustomerCommand) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      const code = await this.customers.nextCode(tx);
      const customer = Customer.create({ ...input, tenantId: ctx.tenantId, code, ownerId: input.ownerId ?? ctx.userId });
      const { taxId } = customer.snapshot();
      if (taxId && (await tx.customer.findFirst({ where: { taxId }, select: { id: true } }))) {
        throw new ConflictError(`Ya existe un cliente con CUIT ${taxId}`);
      }
      await this.customers.insert(tx, customer, ctx.actor);
      scope.track(customer);
      scope.auditLog({ action: 'customer.create', entityType: 'customer', entityId: customer.id, after: customer.snapshot() });
      return { id: customer.id, code };
    });
  }
}
