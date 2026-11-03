import Joi from 'joi';

/**
 * PATCH /profile body — claim a custom nickname. Must be a lowercase slug:
 * 3–24 chars of [a-z0-9_]. Auto-generated handles (`cb…`) follow the same
 * rules, so every nickname in the system satisfies one pattern.
 */
export interface UpdateProfileDto {
  nickname: string;
}

export const NICKNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export const updateProfileSchema = Joi.object({
  // joi 18 quirk (see components dto): `.case('lower')`, not `.lower()`.
  nickname: Joi.string().trim().case('lower').pattern(NICKNAME_PATTERN).required(),
});
