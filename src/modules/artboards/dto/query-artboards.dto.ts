import Joi from 'joi';

/**
 * GET /artboards query (server-side pagination + search + sort).
 * Values arrive as query strings; joi `convert` normalizes them.
 *
 * `search` matches title OR content (ILIKE, wildcards escaped).
 * `sortBy` supports 'title' | 'createdAt'; `sortOrder` is lower-case
 * ('asc' | 'desc'); when omitted the service defaults to createdAt desc.
 */
export interface QueryArtboardsDto {
  page: number;
  limit: number;
  search?: string;
  sortBy?: 'title' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export const queryArtboardsSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  search: Joi.string().trim().max(200).optional(),
  sortBy: Joi.valid('title', 'createdAt').optional(),
  sortOrder: Joi.valid('asc', 'desc').optional(),
});
