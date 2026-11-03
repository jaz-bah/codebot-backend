import Joi from 'joi';

/** POST /chat/conversations/:id/messages body. Plain text only (no attachment support yet). */
export interface SendMessageDto {
  content: string;
}

export const sendMessageSchema = Joi.object({
  content: Joi.string().trim().min(1).max(5000).required(),
});
