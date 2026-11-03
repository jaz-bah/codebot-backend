import Joi from 'joi';
import { DOCUMENT_NAME_MAX_LENGTH, DOCUMENT_DESCRIPTION_MAX_LENGTH } from './document.constants';

/**
 * POST /documents — multipart/form-data with the binary in field `file` plus
 * optional metadata fields `name` and `description`.
 *
 * `name` omitted/null/blank → the service falls back to the sanitized original
 * filename of the uploaded file. `description` empty → stored as NULL.
 * (Multipart text fields always arrive as strings, so `null` only comes from
 * direct service use; `empty('')` covers blank form fields.)
 */
export interface CreateDocumentDto {
  name?: string;
  description: string | null;
}

export const createDocumentSchema = Joi.object({
  name: Joi.string().trim().min(1).max(DOCUMENT_NAME_MAX_LENGTH).optional(),
  description: Joi.string().trim().max(DOCUMENT_DESCRIPTION_MAX_LENGTH).empty('').allow(null).default(null),
});
