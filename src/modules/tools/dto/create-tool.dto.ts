import Joi from 'joi';

/**
 * Request body for POST /tools. `name` and `downloadLink` are required;
 * the link must be a valid http(s) URL.
 */
export interface CreateToolDto {
  name: string;
  description: string | null;
  downloadLink: string;
}

export const createToolSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  description: Joi.string().trim().max(5000).empty('').allow(null).default(null),
  downloadLink: Joi.string()
    .trim()
    .uri({ scheme: ['http', 'https'] })
    .max(2048)
    .required(),
});
