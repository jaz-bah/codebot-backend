import Joi from 'joi';

/**
 * Request body for PATCH /settings. Partial update — at least one known field
 * must be present (the service rejects an empty remainder as 400). Sending
 * explicit `null` CLEARS a stored credential; unknown keys are stripped.
 *
 * Values arrive plaintext over TLS and are stored encrypted at rest; they are
 * never returned by the API (GET returns masked previews).
 */
export interface UpdateSettingsDto {
  openRouterApiKey?: string | null;
  cloudinaryCloudName?: string | null;
  cloudinaryApiKey?: string | null;
  cloudinaryApiSecret?: string | null;
}

const secretValue = Joi.string().trim().min(4).max(512).allow(null);

export const updateSettingsSchema = Joi.object({
  openRouterApiKey: secretValue.optional(),
  cloudinaryCloudName: Joi.string().trim().min(1).max(255).allow(null).optional(),
  cloudinaryApiKey: secretValue.optional(),
  cloudinaryApiSecret: secretValue.optional(),
});
