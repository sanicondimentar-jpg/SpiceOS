import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CreateCustomerHandler } from './application/commands/create-customer.command';
import { UpdateCustomerHandler } from './application/commands/update-customer.command';
import {
  FindInactiveCustomersHandler,
  GetCustomer360Handler,
  ListCustomersHandler,
} from './application/queries/customer.queries';
import { CUSTOMER_REPOSITORY } from './domain/customer.repository';
import { PrismaCustomerRepository } from './infrastructure/prisma-customer.repository';
import { CustomersController } from './interface/http/customers.controller';
import { CrmAiTools } from './interface/ai-tools/crm.tools';
import { CrmFacade } from './crm.facade';
import { CrmConsumer } from './interface/crm.consumer';

@Module({
  imports: [CqrsModule],
  controllers: [CustomersController],
  providers: [
    { provide: CUSTOMER_REPOSITORY, useClass: PrismaCustomerRepository },
    CreateCustomerHandler,
    UpdateCustomerHandler,
    ListCustomersHandler,
    GetCustomer360Handler,
    FindInactiveCustomersHandler,
    CrmAiTools,
    CrmFacade,
    CrmConsumer,
  ],
  exports: [CrmFacade],
})
export class CrmModule {}
