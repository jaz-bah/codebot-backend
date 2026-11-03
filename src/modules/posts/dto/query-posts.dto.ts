import Joi from 'joi';
import { POST_RESOURCE_TYPES } from '../../../database/typeorm/entities/post.entity';

/**
 * GET /posts (public feed) + GET /posts/me query — server-side pagination +
 * search + filter + sort. Values arrive as query strings; joi `convert`
 * normalizes them.
 *
 * `sortBy`: 'createdAt' | 'updatedAt' | 'votes' (upvote count). `sortOrder`
 * is case-sensitive lower-case ('asc' | 'desc'); the service defaults to
 * 'desc' — always the "best/most recent first" meaning.
 */
export interface QueryPostsDto {
  page: number;
  limit: number;
  search?: string;
  resourceType?: (typeof POST_RESOURCE_TYPES)[number];
  sortBy?: 'createdAt' | 'updatedAt' | 'votes';
  sortOrder?: 'asc' | 'desc';
}

export const queryPostsSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  search: Joi.string().trim().max(200).optional(),
  resourceType: Joi.valid(...POST_RESOURCE_TYPES).optional(),
  sortBy: Joi.valid('createdAt', 'updatedAt', 'votes').optional(),
  sortOrder: Joi.valid('asc', 'desc').optional(),
});
