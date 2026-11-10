import Joi from 'joi';
import { MAX_ARTBOARD_CONTENT_LENGTH } from './content-length.constant';

/**
 * PATCH /artboards/:id body. Partial update — at least one known field must be
 * present (the service rejects an empty remainder as 400). `content` replaces
 * the stored payload VERBATIM (no trim/normalization); empty string clears it.
 */
export interface UpdateArtboardDto {
  title?: string;
  content?: string;
}

export const updateArtboardSchema = Joi.object({
  title: Joi.string().trim().min(1).max(255).optional(),
  content: Joi.string().max(MAX_ARTBOARD_CONTENT_LENGTH).allow('').optional(),
});
