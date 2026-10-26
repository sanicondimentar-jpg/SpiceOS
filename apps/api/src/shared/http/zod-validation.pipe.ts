import { PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/** Valida body/query con los esquemas compartidos de @spiceos/contracts. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
