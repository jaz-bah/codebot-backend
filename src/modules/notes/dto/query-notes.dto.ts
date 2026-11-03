import Joi from 'joi';

/**
 * GET /notes query — server-side pagination + search + filter + sort across
 * the user's notes. `search` matches note CONTENT and the HTML file name.
 * `folderId` filters notes whose file lives in that folder.
 */
export interface QueryNotesDto {
  page: number;
  limit: number;
  search?: string;
  folderId?: string;
  sortBy?: 'updatedAt' | 'createdAt' | 'fileName';
  sortOrder?: 'asc' | 'desc';
}

export const queryNotesSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  search: Joi.string().trim().max(200).optional(),
  folderId: Joi.string().uuid().optional(),
  sortBy: Joi.valid('updatedAt', 'createdAt', 'fileName').optional(),
  sortOrder: Joi.valid('asc', 'desc').optional(),
});
