import Joi from 'joi';
import { TODO_PRIORITIES, TODO_STATUSES } from '../../../database/typeorm/entities/todo.entity';

/**
 * GET /todos query (server-side pagination + search + filter + sort).
 * Values arrive as query strings; joi `convert` normalizes them.
 *
 * `sortBy`: 'createdAt' | 'dueDate' | 'priority' | 'position' (manual order).
 * `sortOrder` is case-sensitive lower-case ('asc' | 'desc'); when omitted the
 * service picks a sensible default per field (position → asc, else desc).
 */
export interface QueryTodosDto {
  page: number;
  limit: number;
  search?: string;
  status?: (typeof TODO_STATUSES)[number];
  priority?: (typeof TODO_PRIORITIES)[number];
  sortBy?: 'createdAt' | 'dueDate' | 'priority' | 'position';
  sortOrder?: 'asc' | 'desc';
}

export const queryTodosSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  search: Joi.string().trim().max(200).optional(),
  status: Joi.valid(...TODO_STATUSES).optional(),
  priority: Joi.valid(...TODO_PRIORITIES).optional(),
  sortBy: Joi.valid('createdAt', 'dueDate', 'priority', 'position').optional(),
  sortOrder: Joi.valid('asc', 'desc').optional(),
});
