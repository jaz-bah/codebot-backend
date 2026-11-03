import Joi from 'joi';

/**
 * Request body for PATCH /experts/:id. Partial update — at least one known
 * field must be present (the service rejects an empty remainder as 400).
 */
export interface UpdateExpertDto {
  title?: string;
  description?: string | null;
}

export const updateExpertSchema = Joi.object({
  title: Joi.string().trim().min(1).max(255).optional(),
  description: Joi.string().trim().max(5000).empty('').allow(null).optional(),
});
