import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { DomainError } from '../domain/errors';

const STATUS: Record<string, number> = {
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  business_rule: HttpStatus.UNPROCESSABLE_ENTITY,
};

/** Traduce errores de dominio y de validación a respuestas RFC 7807. */
@Catch(DomainError, ZodError, Prisma.PrismaClientKnownRequestError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(error: DomainError | ZodError | Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const known: Record<string, [number, string]> = {
        P2002: [409, 'Ya existe un registro con esos datos únicos'],
        P2025: [404, 'El registro no existe'],
      };
      const [status, title] = known[error.code] ?? [500, 'Error de base de datos'];
      return res.status(status).type('application/problem+json').json({ type: error.code, title, status });
    }
    if (error instanceof ZodError) {
      return res.status(400).type('application/problem+json').json({
        type: 'validation_error',
        title: 'Datos inválidos',
        status: 400,
        errors: error.issues,
      });
    }
    const status = STATUS[error.code] ?? HttpStatus.BAD_REQUEST;
    return res.status(status).type('application/problem+json').json({
      type: error.code,
      title: error.message,
      status,
    });
  }
}
