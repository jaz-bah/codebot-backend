import Joi from 'joi';
import { TODO_PRIORITIES, TODO_STATUSES } from '../../../database/typeorm/entities/todo.entity';
import type { TodoPriority, TodoStatus } from '../../../database/typeorm/entities/todo.entity';

/**
 * Request body for PATCH /todos/:id. Partial update — at least one known field
 * must be present (the service rejects an empty remainder as 400).
 */
export interface UpdateTodoDto {
  title?: string;
  description?: string | null;
  status?: TodoStatus;
  priority?: TodoPriority;
  dueDate?: Date | null;
  position?: number;
}

export const updateTodoSchema = Joi.object({
  title: Joi.string().trim().min(1).max(255).optional(),
  description: Joi.string().trim().max(5000).empty('').allow(null).optional(),
  status: Joi.valid(...TODO_STATUSES).optional(),
  priority: Joi.valid(...TODO_PRIORITIES).optional(),
  dueDate: Joi.date().iso().empty('').allow(null).optional(),
  position: Joi.number().integer().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});
