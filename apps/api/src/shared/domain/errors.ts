/** Errores de dominio: el filtro HTTP los traduce a códigos de estado. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('not_found', `${entity} ${id} no existe`);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super('conflict', message);
  }
}

export class BusinessRuleError extends DomainError {
  constructor(message: string) {
    super('business_rule', message);
  }
}
