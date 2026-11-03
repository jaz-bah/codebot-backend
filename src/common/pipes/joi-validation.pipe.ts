import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ObjectSchema } from 'joi';

/**
 * Request validation with joi — the validation library this project already
 * depends on (env validation). No class-validator/class-transformer needed.
 *
 * - `stripUnknown: true` → unknown keys are silently dropped (stable payloads).
 * - `convert: true` → query strings become numbers/dates per the schema.
 * - Validation errors surface as ONE 400 message:
 *   "field: problem; field2: problem2" (HttpExceptionFilter envelope).
 */
@Injectable()
export class JoiValidationPipe implements PipeTransform {
  constructor(private readonly schema: ObjectSchema) {}

  transform(value: unknown): unknown {
    const { error, value: validated } = this.schema.validate(value, {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      const message = error.details
        .map((d) => `${d.path.filter((p) => typeof p !== 'symbol').join('.')}: ${d.message}`)
        .join('; ');
      throw new BadRequestException(message);
    }
    return validated;
  }
}
