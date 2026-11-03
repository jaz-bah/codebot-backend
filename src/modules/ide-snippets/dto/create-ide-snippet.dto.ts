import Joi from 'joi';

/**
 * Request body for POST /ide-snippets. Both `language` and `data` are
 * required; `data` is stored EXACTLY as received (no trim, no reformatting)
 * so whitespace, line breaks and special characters survive round trips.
 */
export interface CreateIdeSnippetDto {
  language: string;
  data: string;
}

export const createIdeSnippetSchema = Joi.object({
  language: Joi.string().trim().min(1).max(50).required(),
  data: Joi.string().min(1).max(20000).required(),
});
