import Joi from 'joi';

/**
 * Request body for POST /experts.
 */
export interface CreateExpertDto {
  title: string;
  description: string | null;
}

export const createExpertSchema = Joi.object({
  title: Joi.string().trim().min(1).max(255).required(),
  description: Joi.string().trim().max(5000).empty('').allow(null).default(null),
});
