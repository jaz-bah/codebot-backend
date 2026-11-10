import Joi from 'joi';
import { MAX_ARTBOARD_CONTENT_LENGTH } from './content-length.constant';

/**
 * Request body for POST /artboards. `content` is stored verbatim — NO trim,
 * no normalization — so line breaks, JSON, HTML and special characters survive
 * byte-exactly (same contract as notes). Only the title is trimmed.
 */
export interface CreateArtboardDto {
  title: string;
  content: string;
}

export const createArtboardSchema = Joi.object({
  title: Joi.string().trim().min(1).max(255).required(),
  content: Joi.string().max(MAX_ARTBOARD_CONTENT_LENGTH).allow('').default(''),
});
