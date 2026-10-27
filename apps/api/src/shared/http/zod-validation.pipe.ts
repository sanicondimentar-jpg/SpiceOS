import { PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/** Valida body/query con los esquemas compartidos de @spiceos/contracts. La entrada puede diferir de la salida (transformaciones). */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
