import Joi from 'joi';

/**
 * GET /experts query (server-side pagination + search + sort).
 * Values arrive as query strings; joi `convert` normalizes them.
 *
 * `sortBy`: 'createdAt' | 'title'.
 * `sortOrder` is case-sensitive lower-case ('asc' | 'desc'); when omitted the
 * service picks a sensible default per field (title → asc, else desc).
 */
export interface QueryExpertsDto {
  page: number;
  limit: number;
  search?: string;
  sortBy?: 'createdAt' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export const queryExpertsSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  search: Joi.string().trim().max(200).optional(),
  sortBy: Joi.valid('createdAt', 'title').optional(),
  sortOrder: Joi.valid('asc', 'desc').optional(),
});
