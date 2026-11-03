import Joi from 'joi';
import { COMPONENT_LANGUAGE_PATTERN } from './component.constants';

/**
 * GET /components query (server-side pagination + search + filter + sort).
 * Values arrive as query strings; joi `convert` normalizes them.
 *
 * `search` matches the component name only (LIKE-escaped ILIKE).
 * `language` keeps only components that have at least one file tagged with
 * that language (EXISTS subquery — no join fan-out).
 * `sortOrder` is case-sensitive lower-case ('asc' | 'desc'); when omitted the
 * service picks a sensible default per field (name → asc, else desc).
 */
export interface QueryComponentsDto {
  page: number;
  limit: number;
  search?: string;
  language?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export const queryComponentsSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  search: Joi.string().trim().max(200).optional(),
  language: Joi.string().trim().case('lower').pattern(COMPONENT_LANGUAGE_PATTERN).optional(),
  sortBy: Joi.valid('createdAt', 'updatedAt', 'name').optional(),
  sortOrder: Joi.valid('asc', 'desc').optional(),
});
