import Joi from 'joi';
import { TODO_PRIORITIES, TODO_STATUSES } from '../../../database/typeorm/entities/todo.entity';
import type { TodoPriority, TodoStatus } from '../../../database/typeorm/entities/todo.entity';

/**
 * Request body for POST /todos. `position` is optional — when absent the todo
 * is appended at the end of the user's ordering inside a transaction.
 */
export interface CreateTodoDto {
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  dueDate: Date | null;
  position?: number;
}

export const createTodoSchema = Joi.object({
  title: Joi.string().trim().min(1).max(255).required(),
  description: Joi.string().trim().max(5000).empty('').allow(null).default(null),
  status: Joi.valid(...TODO_STATUSES).default('pending'),
  priority: Joi.valid(...TODO_PRIORITIES).default('medium'),
  dueDate: Joi.date().iso().empty('').allow(null).default(null),
  position: Joi.number().integer().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
});
