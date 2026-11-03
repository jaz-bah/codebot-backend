import Joi from 'joi';

/**
 * POST /chat/conversations body — start (or open) a 1:1 conversation by the
 * target's username. Constraints mirror the BetterAuth username plugin
 * defaults exactly (3–30, [a-zA-Z0-9_.], stored lowercase) so an exact lookup
 * can never be defeated by an input the plugin itself would have rejected.
 */
export interface StartConversationDto {
  username: string;
}

export const startConversationSchema = Joi.object({
  username: Joi.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_.]+$/).required(),
});
