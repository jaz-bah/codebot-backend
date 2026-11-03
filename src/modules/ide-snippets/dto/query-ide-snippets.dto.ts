import Joi from 'joi';

/**
 * GET /ide-snippets query (server-side pagination + search + filter + sort).
 * Values arrive as query strings; joi `convert` normalizes them.
 *
 * `search` matches `data` OR `language` (case-insensitive ILIKE).
 * `language` filters by exact language (any stored value).
 * `sortBy`: 'createdAt' | 'language'; default sort is createdAt desc
 * (language → asc when omitted).
 */
export interface QueryIdeSnippetsDto {
  page: number;
  limit: number;
  search?: string;
  language?: string;
  sortBy?: 'createdAt' | 'language';
  sortOrder?: 'asc' | 'desc';
}

export const queryIdeSnippetsSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  search: Joi.string().trim().max(200).optional(),
  language: Joi.string().trim().min(1).max(50).optional(),
  sortBy: Joi.valid('createdAt', 'language').optional(),
  sortOrder: Joi.valid('asc', 'desc').optional(),
});
