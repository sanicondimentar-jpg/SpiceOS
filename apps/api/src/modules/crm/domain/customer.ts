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
      status: input.source === 'whatsapp' || input.source === 'web' ? 'PROSPECT' : 'ACTIVE',
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

/**
 * Normaliza a E.164 asumiendo Argentina cuando falta el código de país.
 * Celulares argentinos: se quita el "15" local y se agrega el 9 que usa WhatsApp
 * ("011 15-4444-5555" → +5491144445555). Números con "+" o "00" conservan su país.
 */
export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  if (trimmed.startsWith('+') || digits.startsWith('00')) {
    digits = digits.replace(/^00/, '');
    if (!digits.startsWith('54')) return `+${digits}`;
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  let national = digits.startsWith('54') && digits.length >= 12 ? digits.slice(2) : digits;
  if (national.startsWith('9') && national.length === 11) return `+54${national}`;
  if (national.length === 12) {
    // Área de 2, 3 o 4 dígitos seguida de "15": es un celular.
    for (const areaLen of [2, 3, 4]) {
      if (national.slice(areaLen, areaLen + 2) === '15') {
        national = `9${national.slice(0, areaLen)}${national.slice(areaLen + 2)}`;
        return `+54${national}`;
      }
    }
  }
  return `+54${national}`;
}

/**
 * Formas en que puede estar guardado el mismo número argentino: con y sin el 9 de celular.
 * Un fijo cargado sin 9 tiene que coincidir con el WhatsApp entrante, que siempre trae el 9.
 */
export function phoneVariants(phone?: string | null): string[] {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  if (normalized.startsWith('+549')) return [normalized, `+54${normalized.slice(4)}`];
  if (normalized.startsWith('+54')) return [normalized, `+549${normalized.slice(3)}`];
  return [normalized];
}
