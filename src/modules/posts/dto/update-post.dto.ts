import Joi from 'joi';

/**
 * Request body for PATCH /posts/:id — post-specific presentation metadata
 * only. The (resourceType, resourceId) reuse target is immutable: re-pointing
 * a post at another resource is not an update operation (delete + publish).
 */
export interface UpdatePostDto {
  title?: string;
  description?: string | null;
}

export const updatePostSchema = Joi.object({
  title: Joi.string().trim().min(1).max(200).optional(),
  description: Joi.string().trim().max(2000).empty('').allow(null).optional(),
}).min(1);
