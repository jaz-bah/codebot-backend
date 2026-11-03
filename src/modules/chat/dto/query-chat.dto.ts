import Joi from 'joi';

/**
 * GET /chat/conversations and GET /chat/conversations/:id/messages
 * query (server-side pagination over newest-first results).
 */
export interface QueryChatDto {
  page: number;
  limit: number;
}

export const queryChatSchema = Joi.object({
  page: Joi.number().integer().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});
