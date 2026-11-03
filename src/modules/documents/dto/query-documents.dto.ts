import Joi from 'joi';

/**
 * GET /documents query (server-side pagination + search + sort).
 * Values arrive as query strings; joi `convert` normalizes them.
 *
 * `search` matches name OR description (case-insensitive, LIKE-escaped).
 * `sortOrder` is case-sensitive lower-case ('asc' | 'desc'); when omitted the
 * service picks a sensible default per field (name → asc, else desc).
 */
export interface QueryDocumentsDto {
  page: number;
  limit: number;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export const queryDocumentsSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  search: Joi.string().trim().max(200).optional(),
  sortBy: Joi.valid('createdAt', 'updatedAt', 'name').optional(),
  sortOrder: Joi.valid('asc', 'desc').optional(),
});
