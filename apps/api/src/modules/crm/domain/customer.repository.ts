import type { Tx } from '../../../shared/prisma/prisma.service';
import type { Customer } from './customer';

export const CUSTOMER_REPOSITORY = Symbol('CustomerRepository');

/** Puerto del dominio; la implementación vive en infrastructure/. */
export interface CustomerRepository {
  findById(tx: Tx, id: string): Promise<Customer | null>;
  findByPhone(tx: Tx, phones: string[]): Promise<Customer | null>;
  nextCode(tx: Tx): Promise<string>;
  insert(tx: Tx, customer: Customer, createdBy: string): Promise<void>;
  update(tx: Tx, customer: Customer, updatedBy: string): Promise<void>;
}
