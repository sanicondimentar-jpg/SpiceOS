import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, contactSchema, updateContactSchema, type ContactInput, type UpdateContactInput } from '@spiceos/contracts';
import { RequirePermissions } from '../../../../shared/auth/decorators';
import { ZodPipe } from '../../../../shared/http/zod-validation.pipe';
import { ContactsService } from '../../application/contacts.service';

@ApiTags('CRM')
@ApiBearerAuth()
@Controller('crm/customers/:customerId/contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.crm.customerRead)
  list(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.contacts.list(customerId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.crm.customerWrite)
  create(@Param('customerId', ParseUUIDPipe) customerId: string, @Body(new ZodPipe(contactSchema)) body: ContactInput) {
    return this.contacts.create(customerId, body);
  }

  @Patch(':contactId')
  @RequirePermissions(PERMISSIONS.crm.customerWrite)
  update(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body(new ZodPipe(updateContactSchema)) body: UpdateContactInput,
  ) {
    return this.contacts.update(customerId, contactId, body);
  }

  @Delete(':contactId')
  @RequirePermissions(PERMISSIONS.crm.customerWrite)
  remove(@Param('customerId', ParseUUIDPipe) customerId: string, @Param('contactId', ParseUUIDPipe) contactId: string) {
    return this.contacts.remove(customerId, contactId);
  }
}
