import Joi from 'joi';
import { DOCUMENT_NAME_MAX_LENGTH, DOCUMENT_DESCRIPTION_MAX_LENGTH } from './document.constants';

/**
 * PATCH /documents/:id. Metadata-only update — at least one known field must
 * be present (the service rejects an empty remainder as 400). The file bytes
 * and url are immutable here: to replace a file, POST a new document.
 */
export interface UpdateDocumentDto {
  name?: string;
  description?: string | null;
}

export const updateDocumentSchema = Joi.object({
  name: Joi.string().trim().min(1).max(DOCUMENT_NAME_MAX_LENGTH).optional(),
  description: Joi.string().trim().max(DOCUMENT_DESCRIPTION_MAX_LENGTH).empty('').allow(null).optional(),
});
