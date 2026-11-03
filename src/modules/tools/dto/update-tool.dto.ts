import Joi from 'joi';

/**
 * Request body for PATCH /tools/:id. Partial update — at least one known field
 * must be present (the service rejects an empty remainder as 400).
 */
export interface UpdateToolDto {
  name?: string;
  description?: string | null;
  downloadLink?: string;
}

export const updateToolSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).optional(),
  description: Joi.string().trim().max(5000).empty('').allow(null).optional(),
  downloadLink: Joi.string()
    .trim()
    .uri({ scheme: ['http', 'https'] })
    .max(2048)
    .optional(),
});
