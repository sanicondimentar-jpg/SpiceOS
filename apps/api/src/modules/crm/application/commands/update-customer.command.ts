import { Inject } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import type { UpdateCustomerInput } from '@spiceos/contracts';
import { UnitOfWork } from '../../../../shared/unit-of-work';
import { NotFoundError } from '../../../../shared/domain/errors';
import { RequestContextStore } from '../../../../shared/tenancy/request-context';
import { CUSTOMER_REPOSITORY, CustomerRepository } from '../../domain/customer.repository';

export class UpdateCustomerCommand {
  constructor(
    readonly id: string,
    readonly input: UpdateCustomerInput,
  ) {}
}

@CommandHandler(UpdateCustomerCommand)
export class UpdateCustomerHandler implements ICommandHandler<UpdateCustomerCommand, { version: number }> {
  constructor(
    private readonly uow: UnitOfWork,
    @Inject(CUSTOMER_REPOSITORY) private readonly customers: CustomerRepository,
  ) {}

  execute({ id, input }: UpdateCustomerCommand) {
    return this.uow.run(async (tx, scope) => {
      const customer = await this.customers.findById(tx, id);
      if (!customer) throw new NotFoundError('Cliente', id);
      const before = customer.snapshot();
      const { version, ...changes } = input;
      customer.update(changes, version);
      await this.customers.update(tx, customer, RequestContextStore.get().actor);
      scope.track(customer);
      scope.auditLog({ action: 'customer.update', entityType: 'customer', entityId: id, before, after: customer.snapshot() });
      return { version: customer.version };
    });
  }
}
