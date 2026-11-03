import Joi from 'joi';

/**
 * Request body for PATCH /ide-snippets/:id. Partial update — at least one
 * known field must be present (the service rejects an empty remainder as
 * 400). `data` is stored EXACTLY as received (no trimming).
 */
export interface UpdateIdeSnippetDto {
  language?: string;
  data?: string;
}

export const updateIdeSnippetSchema = Joi.object({
  language: Joi.string().trim().min(1).max(50).optional(),
  data: Joi.string().min(1).max(20000).optional(),
});
