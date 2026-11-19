import { Injectable } from '@nestjs/common';
import type { Customer as Row } from '@prisma/client';
import type { CustomerAddressInput } from '@spiceos/contracts';
import type { Tx } from '../../../shared/prisma/prisma.service';
import { ConflictError } from '../../../shared/domain/errors';
import { Customer } from '../domain/customer';
import type { CustomerRepository } from '../domain/customer.repository';

@Injectable()
export class PrismaCustomerRepository implements CustomerRepository {
  async findById(tx: Tx, id: string) {
    const row = await tx.customer.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findByPhone(tx: Tx, phones: string[]) {
    const row = await tx.customer.findFirst({
      where: { deletedAt: null, OR: [{ phone: { in: phones } }, { contacts: { some: { phone: { in: phones }, deletedAt: null } } }] },
    });
    return row ? toDomain(row) : null;
  }

  async nextCode(tx: Tx) {
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) + 1 AS n FROM customers`;
    return `C${String(n).padStart(6, '0')}`;
  }

  async insert(tx: Tx, customer: Customer, createdBy: string) {
    const s = customer.snapshot();
    await tx.customer.create({ data: { ...s, createdBy: uuidOrNull(createdBy), updatedBy: uuidOrNull(createdBy) } });
  }

  /** Bloqueo optimista: solo actualiza si la versión en base es la anterior. */
  async update(tx: Tx, customer: Customer, updatedBy: string) {
    const { id, tenantId: _t, version, ...rest } = customer.snapshot();
    const res = await tx.customer.updateMany({
      where: { id, version: version - 1 },
      data: { ...rest, version, updatedBy: uuidOrNull(updatedBy) },
    });
    if (res.count === 0) throw new ConflictError('Conflicto de versión al guardar el cliente');
  }

  /** Dirección principal: actualiza la que está marcada (o la primera) o crea una nueva. */
  async saveMainAddress(tx: Tx, tenantId: string, customerId: string, address: CustomerAddressInput) {
    const data = {
      street: address.street,
      city: address.city,
      province: address.province,
      postalCode: address.postalCode ?? null,
      deliveryNote: address.deliveryNote ?? null,
    };
    const current = await tx.customerAddress.findFirst({ where: { customerId }, orderBy: { isDefault: 'desc' }, select: { id: true } });
    if (current) await tx.customerAddress.update({ where: { id: current.id }, data: { ...data, isDefault: true } });
    else await tx.customerAddress.create({ data: { ...data, tenantId, customerId, label: 'Principal', isDefault: true } });
  }
}

const uuidOrNull = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : null);

function toDomain(r: Row): Customer {
  return Customer.restore({
    id: r.id,
    tenantId: r.tenantId,
    code: r.code,
    legalName: r.legalName,
    tradeName: r.tradeName,
    taxId: r.taxId,
    taxCondition: r.taxCondition,
    industry: r.industry,
    status: r.status,
    ownerId: r.ownerId,
    priceListId: r.priceListId,
    paymentTermsDays: r.paymentTermsDays,
    creditLimit: r.creditLimit ? Number(r.creditLimit) : null,
    phone: r.phone,
    email: r.email,
    deliveryDays: r.deliveryDays,
    deliveryHours: r.deliveryHours,
    source: r.source,
    tags: r.tags,
    lastOrderAt: r.lastOrderAt,
    riskScore: r.riskScore,
    version: r.version,
  });
}
