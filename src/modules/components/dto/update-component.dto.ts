import Joi from 'joi';
import {
  COMPONENT_NAME_MAX_LENGTH,
  COMPONENT_PREVIEW_MAX_LENGTH,
  COMPONENT_PREVIEW_PATTERN,
} from './component.constants';
import { componentFileSchema, ComponentFileInputDto } from './create-component.dto';

/**
 * PATCH /components/:id. Partial update — at least one known field must be
 * present (the service rejects an empty remainder as 400).
 *
 * When `files` is present it replaces the ENTIRE file set for the component
 * (delete-then-insert inside one transaction); omitted `files` keeps them
 * untouched. Every other field (including `code` formatting) is stored verbatim.
 */
export interface UpdateComponentDto {
  name?: string;
  preview?: string;
  files?: ComponentFileInputDto[];
}

export const updateComponentSchema = Joi.object({
  name: Joi.string().trim().min(1).max(COMPONENT_NAME_MAX_LENGTH).optional(),
  preview: Joi.string()
    .trim()
    .min(1)
    .max(COMPONENT_PREVIEW_MAX_LENGTH)
    .pattern(COMPONENT_PREVIEW_PATTERN)
    .message('preview must be an absolute URL (https://…) or a root-relative path (/…)')
    .optional(),
  files: Joi.array().items(componentFileSchema).min(1).max(20).optional(),
});
