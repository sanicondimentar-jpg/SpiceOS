import { Injectable } from '@nestjs/common';
import type { ContactInput, UpdateContactInput } from '@spiceos/contracts';
import { DomainEvent } from '../../../shared/domain/domain-event';
import { NotFoundError } from '../../../shared/domain/errors';
import type { Tx } from '../../../shared/prisma/prisma.service';
import { RequestContextStore } from '../../../shared/tenancy/request-context';
import { UnitOfWork } from '../../../shared/unit-of-work';
import { normalizePhone } from '../domain/customer';

/** Contactos de un cliente. El teléfono se guarda en E.164 para asociar los WhatsApp entrantes. */
@Injectable()
export class ContactsService {
  constructor(private readonly uow: UnitOfWork) {}

  list(customerId: string) {
    return this.uow.read(async (tx) => {
      await this.assertCustomer(tx, customerId);
      return tx.contact.findMany({
        where: { customerId, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
      });
    });
  }

  create(customerId: string, input: ContactInput) {
    const ctx = RequestContextStore.get();
    return this.uow.run(async (tx, scope) => {
      await this.assertCustomer(tx, customerId);
      const hasPrimary = await tx.contact.count({ where: { customerId, deletedAt: null, isPrimary: true } });
      // El primer contacto del cliente queda como principal.
      const isPrimary = input.isPrimary || hasPrimary === 0;
      if (isPrimary) await this.clearPrimary(tx, customerId);
      const contact = await tx.contact.create({
        data: { ...input, isPrimary, phone: normalizePhone(input.phone), customerId, tenantId: ctx.tenantId },
      });
      scope.emit(new DomainEvent('contact.created', 'customer', customerId, { customerId, contactId: contact.id, phone: contact.phone }));
      scope.auditLog({ action: 'contact.create', entityType: 'contact', entityId: contact.id, after: contact });
      return contact;
    });
  }

  update(customerId: string, contactId: string, input: UpdateContactInput) {
    return this.uow.run(async (tx, scope) => {
      const before = await this.find(tx, customerId, contactId);
      if (input.isPrimary) await this.clearPrimary(tx, customerId);
      const after = await tx.contact.update({
        where: { id: contactId },
        data: { ...input, ...(input.phone !== undefined && { phone: normalizePhone(input.phone) }) },
      });
      scope.auditLog({ action: 'contact.update', entityType: 'contact', entityId: contactId, before, after });
      return after;
    });
  }

  remove(customerId: string, contactId: string) {
    return this.uow.run(async (tx, scope) => {
      const before = await this.find(tx, customerId, contactId);
      await tx.contact.update({ where: { id: contactId }, data: { deletedAt: new Date(), isPrimary: false } });
      if (before.isPrimary) {
        const next = await tx.contact.findFirst({ where: { customerId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
        if (next) await tx.contact.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      scope.auditLog({ action: 'contact.delete', entityType: 'contact', entityId: contactId, before });
      return { id: contactId };
    });
  }

  private async assertCustomer(tx: Tx, customerId: string) {
    const customer = await tx.customer.findFirst({ where: { id: customerId, deletedAt: null }, select: { id: true } });
    if (!customer) throw new NotFoundError('Cliente', customerId);
  }

  private async find(tx: Tx, customerId: string, contactId: string) {
    const contact = await tx.contact.findFirst({ where: { id: contactId, customerId, deletedAt: null } });
    if (!contact) throw new NotFoundError('Contacto', contactId);
    return contact;
  }

  private clearPrimary(tx: Tx, customerId: string) {
    return tx.contact.updateMany({ where: { customerId, isPrimary: true }, data: { isPrimary: false } });
  }
}
