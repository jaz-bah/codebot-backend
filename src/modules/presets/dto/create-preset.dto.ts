import Joi from 'joi';

/**
 * Request body for POST /presets. `name`, `language` and `data` are required;
 * `data` is stored EXACTLY as received (no trim, no reformatting) so
 * whitespace, line breaks and special characters survive round trips.
 */
export interface CreatePresetDto {
  name: string;
  language: string;
  data: string;
}

export const createPresetSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  language: Joi.string().trim().min(1).max(50).required(),
  data: Joi.string().min(1).max(20000).required(),
});
