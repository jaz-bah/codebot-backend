import Joi from 'joi';
import { WORKSPACE_FILE_TYPES } from '../../../database/typeorm/entities/workspace-file.entity';
import type { WorkspaceFileType } from '../../../database/typeorm/entities/workspace-file.entity';

/** Max rich-HTML note body accepted by the API (500 KB). */
export const MAX_NOTE_CONTENT_LENGTH = 500_000;

/**
 * A file name that is safe inside a tree: no path separators, no control
 * characters, never `.` / `..`, 1–255 chars after trim.
 */
const nameRule = Joi.string()
  .trim()
  .min(1)
  .max(255)
  .invalid('.', '..')
  .pattern(/^[^\\/\u0000-\u001F\u007F]+$/)
  .message('name must not contain path separators or control characters');

/**
 * POST /files body. `parentId` omitted/null → workspace root. For `file`
 * type the name must end with `.html` (HTML note documents) and an optional
 * initial rich-HTML `content` seeds the note row. Folders must NOT carry
 * content (forbidden → 400).
 */
export interface CreateFileDto {
  name: string;
  type: WorkspaceFileType;
  parentId: string | null;
  content: string | null;
}

export const createFileSchema = Joi.object({
  name: Joi.when('type', {
    is: Joi.valid('file'),
    then: nameRule.pattern(/\.html$/i).message('file name must end with .html'),
    otherwise: nameRule,
  }).required(),
  type: Joi.valid(...WORKSPACE_FILE_TYPES).required(),
  parentId: Joi.string().uuid().empty('').allow(null).default(null),
  content: Joi.when('type', {
    is: Joi.valid('file'),
    then: Joi.string().max(MAX_NOTE_CONTENT_LENGTH).allow(null).default(null),
    // Folders must not carry content; null/omitted passes (normalized to null).
    otherwise: Joi.valid(null).default(null),
  }),
});
