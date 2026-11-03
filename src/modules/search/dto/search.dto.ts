import Joi from 'joi';

/** Max raw query length (scope tokens + search text). */
export const SEARCH_QUERY_MAX_LENGTH = 300;

/** Per-scope hit cap; each selected scope returns up to `limit` results. */
export const SEARCH_MAX_LIMIT = 50;

/**
 * GET /search?q=…&limit=… — unified cross-domain search.
 *
 * `q` supports `@scope` filter tokens, e.g. `@presets invoice-sync`,
 * `@components @todos button`. Tokens may appear anywhere and combine:
 * `@files @documents contract`. Text without tokens searches ALL scopes.
 */
export interface SearchQueryDto {
  q: string;
  limit?: number;
}

export const searchQuerySchema = Joi.object({
  q: Joi.string().trim().min(1).max(SEARCH_QUERY_MAX_LENGTH).required(),
  limit: Joi.number().integer().min(1).max(SEARCH_MAX_LIMIT).optional(),
});
