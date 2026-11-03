import Joi from 'joi';
import { MAX_NOTE_CONTENT_LENGTH } from './create-file.dto';

/**
 * PATCH /notes/:fileId body — replace the rich HTML content of the note that
 * belongs to file `:fileId`. Empty string is allowed (cleared note). The body
 * is stored verbatim, size-capped; rendering/sanitization is client-side.
 */
export interface UpdateNoteDto {
  content: string;
}

export const updateNoteSchema = Joi.object({
  content: Joi.string().max(MAX_NOTE_CONTENT_LENGTH).allow('').required(),
});
