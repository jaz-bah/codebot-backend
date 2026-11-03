import Joi from 'joi';
import {
  COMPONENT_CODE_MAX_LENGTH,
  COMPONENT_LANGUAGE_PATTERN,
  COMPONENT_MAX_FILES,
  COMPONENT_NAME_MAX_LENGTH,
  COMPONENT_PREVIEW_MAX_LENGTH,
  COMPONENT_PREVIEW_PATTERN,
} from './component.constants';

/**
 * One code file of a component.
 *
 * `code` is stored VERBATIM — deliberately NO `.trim()` on it so indentation
 * and formatting survive the round-trip exactly as sent.
 */
export interface ComponentFileInputDto {
  language: string;
  code: string;
}

/** POST /components body. `files` is required — a component without code files cannot exist. */
export interface CreateComponentDto {
  name: string;
  preview: string;
  files: ComponentFileInputDto[];
}

/** Lowercase, short language tag (css, html, js, ts, json, svg…). */
export const componentFileSchema = Joi.object({
  language: Joi.string()
    .trim()
    .case('lower')
    .min(1)
    .max(20)
    .pattern(COMPONENT_LANGUAGE_PATTERN)
    .message('language must be a lowercase slug of at most 20 characters (a-z, 0-9, _ or -)')
    .required(),
  code: Joi.string().max(COMPONENT_CODE_MAX_LENGTH).required(),
});

export const createComponentSchema = Joi.object({
  name: Joi.string().trim().min(1).max(COMPONENT_NAME_MAX_LENGTH).required(),
  preview: Joi.string()
    .trim()
    .min(1)
    .max(COMPONENT_PREVIEW_MAX_LENGTH)
    .pattern(COMPONENT_PREVIEW_PATTERN)
    .message('preview must be an absolute URL (https://…) or a root-relative path (/…)')
    .required(),
  files: Joi.array().items(componentFileSchema).min(1).max(COMPONENT_MAX_FILES).required(),
});
