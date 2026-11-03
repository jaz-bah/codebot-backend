import Joi from 'joi';

/**
 * GET /tools query (server-side pagination + search + sort).
 * Values arrive as query strings; joi `convert` normalizes them.
 *
 * `sortBy`: 'createdAt' | 'name'.
 * `sortOrder` is case-sensitive lower-case ('asc' | 'desc'); when omitted the
 * service picks a sensible default per field (name → asc, else desc).
 */
export interface QueryToolsDto {
  page: number;
  limit: number;
  search?: string;
  sortBy?: 'createdAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export const queryToolsSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  search: Joi.string().trim().max(200).optional(),
  sortBy: Joi.valid('createdAt', 'name').optional(),
  sortOrder: Joi.valid('asc', 'desc').optional(),
});
