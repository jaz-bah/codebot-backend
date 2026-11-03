import Joi from 'joi';
import { POST_RESOURCE_TYPES } from '../../../database/typeorm/entities/post.entity';
import type { PostResourceType } from '../../../database/typeorm/entities/post.entity';

/**
 * Request body for POST /posts — publish an EXISTING resource. The post
 * stores only the public presentation (title/description); the resource's
 * own row keeps its data and is referenced by (resourceType, resourceId).
 * Ownership + no-duplicate guarantees are enforced by PostsService.
 */
export interface CreatePostDto {
  resourceType: PostResourceType;
  resourceId: string;
  title: string;
  description: string | null;
}

export const createPostSchema = Joi.object({
  resourceType: Joi.valid(...POST_RESOURCE_TYPES).required(),
  resourceId: Joi.string().uuid().required(),
  title: Joi.string().trim().min(1).max(200).required(),
  description: Joi.string().trim().max(2000).empty('').allow(null).default(null),
});
