import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateCustomerInput,
  ListQuery,
  PERMISSIONS,
  UpdateCustomerInput,
  createCustomerSchema,
  listQuerySchema,
  updateCustomerSchema,
} from '@spiceos/contracts';
import { RequirePermissions } from '../../../../shared/auth/decorators';
import { ZodPipe } from '../../../../shared/http/zod-validation.pipe';
import { CreateCustomerCommand } from '../../application/commands/create-customer.command';
import { UpdateCustomerCommand } from '../../application/commands/update-customer.command';
import {
  FindInactiveCustomersQuery,
  GetCustomer360Query,
  ListCustomersQuery,
} from '../../application/queries/customer.queries';

@ApiTags('CRM')
@ApiBearerAuth()
@Controller('crm/customers')
export class CustomersController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.crm.customerRead)
  list(
    @Query(new ZodPipe(listQuerySchema)) query: ListQuery,
    @Query('status') status?: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.queries.execute(new ListCustomersQuery({ ...query, status, ownerId }));
  }

  @Get('inactive')
  @RequirePermissions(PERMISSIONS.crm.customerRead)
  inactive(@Query('days') days = '60') {
    return this.queries.execute(new FindInactiveCustomersQuery(Number(days)));
  }

  @Get(':id/360')
  @RequirePermissions(PERMISSIONS.crm.customerRead)
  customer360(@Param('id', ParseUUIDPipe) id: string) {
    return this.queries.execute(new GetCustomer360Query(id));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.crm.customerWrite)
  create(@Body(new ZodPipe(createCustomerSchema)) body: CreateCustomerInput) {
    return this.commands.execute(new CreateCustomerCommand(body));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.crm.customerWrite)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateCustomerSchema)) body: UpdateCustomerInput) {
    return this.commands.execute(new UpdateCustomerCommand(id, body));
  }
}
