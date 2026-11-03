import Joi from 'joi';

/**
 * PATCH /files/:id body — rename and/or move. Both fields optional, but at
 * least one must be present (the service rejects an empty remainder as 400).
 * The `.html` requirement for file renames is enforced by the service (the
 * payload does not carry `type`).
 */
export interface UpdateFileDto {
  name?: string;
  parentId?: string | null;
}

export const updateFileSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(1)
    .max(255)
    .invalid('.', '..')
    .pattern(/^[^\\/\u0000-\u001F\u007F]+$/)
    .message('name must not contain path separators or control characters')
    .optional(),
  parentId: Joi.string().uuid().empty('').allow(null).optional(),
});
