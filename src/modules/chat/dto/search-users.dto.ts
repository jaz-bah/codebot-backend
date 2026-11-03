import Joi from 'joi';

/**
 * GET /chat/users?q=… — people search by USERNAME (BetterAuth `user.username`,
 * plugin-managed: lowercase, 3–30 chars, [a-zA-Z0-9_.]).
 *
 * Rules: callers are excluded from their own results; users without a username
 * are invisible to search until they pick one. `limit` caps the result page.
 */
export interface SearchUsersDto {
  q?: string;
  limit: number;
}

export const SEARCH_USERS_DEFAULT_LIMIT = 10;

export const searchUsersSchema = Joi.object({
  q: Joi.string().trim().max(100).optional(),
  limit: Joi.number().integer().min(1).max(50).optional(),
});
