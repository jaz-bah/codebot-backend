import Joi from 'joi';

/**
 * Request body for PATCH /presets/:id. Partial update — at least one known
 * field must be present (the service rejects an empty remainder as 400).
 * `data` is stored EXACTLY as received (no trimming).
 */
export interface UpdatePresetDto {
  name?: string;
  language?: string;
  data?: string;
}

export const updatePresetSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).optional(),
  language: Joi.string().trim().min(1).max(50).optional(),
  data: Joi.string().min(1).max(20000).optional(),
});
