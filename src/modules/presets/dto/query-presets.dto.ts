import Joi from 'joi';

/**
 * GET /presets query (server-side pagination + search + filter + sort).
 * Values arrive as query strings; joi `convert` normalizes them.
 *
 * `search` matches `name` (case-insensitive ILIKE).
 * `language` filters by exact language (any stored value).
 * `sortBy`: 'createdAt' | 'name'; default sort is createdAt desc
 * (name → asc when omitted).
 */
export interface QueryPresetsDto {
  page: number;
  limit: number;
  search?: string;
  language?: string;
  sortBy?: 'createdAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export const queryPresetsSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  search: Joi.string().trim().max(200).optional(),
  language: Joi.string().trim().min(1).max(50).optional(),
  sortBy: Joi.valid('createdAt', 'name').optional(),
  sortOrder: Joi.valid('asc', 'desc').optional(),
});
