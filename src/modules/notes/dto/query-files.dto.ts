import Joi from 'joi';
import { WORKSPACE_FILE_TYPES } from '../../../database/typeorm/entities/workspace-file.entity';
import type { WorkspaceFileType } from '../../../database/typeorm/entities/workspace-file.entity';

/**
 * GET /files query — folder contents listing (children of `parentId`, or the
 * workspace root when omitted) with server-side search/filter/sort.
 * Values arrive as query strings; joi `convert` normalizes them.
 */
export interface QueryFilesDto {
  page: number;
  limit: number;
  parentId?: string;
  type?: WorkspaceFileType;
  search?: string;
  sortBy?: 'position' | 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export const queryFilesSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  parentId: Joi.string().uuid().optional(),
  type: Joi.valid(...WORKSPACE_FILE_TYPES).optional(),
  search: Joi.string().trim().max(255).optional(),
  sortBy: Joi.valid('position', 'name', 'createdAt', 'updatedAt').optional(),
  sortOrder: Joi.valid('asc', 'desc').optional(),
});
