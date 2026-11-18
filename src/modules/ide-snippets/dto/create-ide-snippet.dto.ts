import Joi from 'joi';

/**
 * Request body for POST /ide-snippets. `language` is always "json" for the
 * UI (kept required for backward compat with other callers); `fileName` is
 * the user-facing identity; `data` is stored EXACTLY as received (no trim,
 * no reformatting) so whitespace, line breaks and special characters survive
 * round trips.
 */
export interface CreateIdeSnippetDto {
  language: string;
  fileName?: string | null;
  data: string;
}

export const createIdeSnippetSchema = Joi.object({
  language: Joi.string().trim().min(1).max(50).required(),
  fileName: Joi.string().trim().min(1).max(255).empty('').allow(null).default(null),
  data: Joi.string().min(1).max(20000).required(),
});
