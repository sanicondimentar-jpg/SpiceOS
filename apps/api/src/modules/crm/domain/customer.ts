import { randomUUID } from 'node:crypto';
import { AggregateRoot } from '../../../shared/domain/aggregate-root';
import { DomainEvent } from '../../../shared/domain/domain-event';
import { BusinessRuleError, ConflictError } from '../../../shared/domain/errors';

export type CustomerStatus = 'PROSPECT' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

export interface CustomerProps {
  id: string;
  tenantId: string;
  code: string;
  legalName: string;
  tradeName?: string | null;
  taxId?: string | null;
  taxCondition?: string | null;
  industry?: string | null;
  status: CustomerStatus;
  ownerId?: string | null;
  priceListId?: string | null;
  paymentTermsDays: number;
  creditLimit?: number | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  tags: string[];
  lastOrderAt?: Date | null;
  riskScore?: number | null;
  version: number;
}

type Editable = Partial<
  Pick<
    CustomerProps,
    | 'legalName'
    | 'tradeName'
    | 'taxId'
    | 'taxCondition'
    | 'industry'
    | 'ownerId'
    | 'priceListId'
    | 'paymentTermsDays'
    | 'creditLimit'
    | 'phone'
    | 'email'
    | 'tags'
  >
>;

/** Agregado Cliente. Invariantes: CUIT normalizado, teléfono E.164, cliente bloqueado no opera. */
export class Customer extends AggregateRoot {
  private constructor(private props: CustomerProps) {
    super();
  }

  static create(input: Omit<CustomerProps, 'id' | 'status' | 'version' | 'tags'> & { tags?: string[] }): Customer {
    const customer = new Customer({
      ...input,
      id: randomUUID(),
      taxId: normalizeTaxId(input.taxId),
      phone: normalizePhone(input.phone),
      status: input.source === 'whatsapp' ? 'PROSPECT' : 'ACTIVE',
      tags: input.tags ?? [],
      version: 1,
    });
    customer.record(
      new DomainEvent('customer.created', 'customer', customer.id, {
        customerId: customer.id,
        legalName: customer.props.legalName,
        source: customer.props.source ?? 'manual',
        ownerId: customer.props.ownerId ?? null,
      }),
    );
    return customer;
  }

  static restore(props: CustomerProps): Customer {
    return new Customer(props);
  }

  get id() {
    return this.props.id;
  }

  get version() {
    return this.props.version;
  }

  snapshot(): Readonly<CustomerProps> {
    return { ...this.props };
  }

  update(changes: Editable, expectedVersion: number): void {
    if (expectedVersion !== this.props.version) {
      throw new ConflictError('El cliente fue modificado por otra persona; recargá y volvé a intentar');
    }
    const next = {
      ...changes,
      ...(changes.taxId !== undefined && { taxId: normalizeTaxId(changes.taxId) }),
      ...(changes.phone !== undefined && { phone: normalizePhone(changes.phone) }),
    };
    this.props = { ...this.props, ...next, version: this.props.version + 1 };
    this.record(new DomainEvent('customer.updated', 'customer', this.id, { customerId: this.id, changes: Object.keys(changes) }));
  }

  block(reason: string): void {
    if (this.props.status === 'BLOCKED') return;
    this.props.status = 'BLOCKED';
    this.props.version++;
    this.record(new DomainEvent('customer.updated', 'customer', this.id, { customerId: this.id, blocked: true, reason }));
  }

  assertCanOrder(): void {
    if (this.props.status === 'BLOCKED') throw new BusinessRuleError('El cliente está bloqueado: no puede recibir pedidos');
  }
}

export function normalizeTaxId(taxId?: string | null): string | null {
  if (!taxId) return null;
  const digits = taxId.replace(/\D/g, '');
  if (digits.length !== 11 || !validCuit(digits)) throw new BusinessRuleError(`CUIT inválido: ${taxId}`);
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function validCuit(d: string): boolean {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === Number(d[10]);
}

/** Normaliza a E.164 asumiendo Argentina cuando falta el código de país. */
export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!digits.startsWith('54')) digits = `54${digits}`;
  return `+${digits}`;
}
