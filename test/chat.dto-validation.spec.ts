import { startConversationSchema } from '../src/modules/chat/dto/start-conversation.dto';
import { sendMessageSchema } from '../src/modules/chat/dto/send-message.dto';
import { searchUsersSchema } from '../src/modules/chat/dto/search-users.dto';
import { queryChatSchema } from '../src/modules/chat/dto/query-chat.dto';

/** DTO validation contract (same style as todos.dto-validation.spec.ts). */

const validate = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  value: unknown,
): { ok: boolean; errors: string[]; value?: Record<string, unknown> } => {
  const { error, value: out } = schema.validate(value, {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: true,
    convert: true,
  });
  return {
    ok: !error,
    errors: (error?.details ?? []).map((d: { message: string }) => d.message) as string[],
    value: out as Record<string, unknown>,
  };
};

describe('chat DTO validation', () => {
  describe('startConversationSchema', () => {
    it('accepts plugin-compatible usernames', () => {
      for (const username of ['alpha', 'A_Z.99', '  beta ']) {
        expect(validate(startConversationSchema, { username }).ok).toBe(true);
      }
    });

    it('rejects usernames the BetterAuth username plugin would reject', () => {
      for (const username of [
        '', 'ab', // too short
        'a'.repeat(31), // too long
        'has space', 'bad/slash', 'no-dashes!', 'ünicode',
      ]) {
        expect(validate(startConversationSchema, { username }).ok).toBe(false);
      }
    });

    it('rejects a missing username and strips unknown keys', () => {
      expect(validate(startConversationSchema, {}).ok).toBe(false);
      const out = validate(startConversationSchema, {
        username: 'alpha',
        targetUserId: 'hack-attempt',
      } as never);
      expect(Object.keys(out.value ?? {})).toEqual(['username']);
    });
  });

  describe('sendMessageSchema', () => {
    it('accepts 1..5000 char trimmed content', () => {
      expect(validate(sendMessageSchema, { content: 'hey' }).ok).toBe(true);
      expect(validate(sendMessageSchema, { content: 'a'.repeat(4999) }).ok).toBe(true);
    });

    it('rejects empty and oversized content', () => {
      expect(validate(sendMessageSchema, { content: '' }).ok).toBe(false);
      expect(validate(sendMessageSchema, { content: '   ' }).ok).toBe(false);
      expect(validate(sendMessageSchema, { content: 'x'.repeat(5001) }).ok).toBe(false);
      expect(validate(sendMessageSchema, {}).ok).toBe(false);
    });
  });

  describe('searchUsersSchema', () => {
    it('accepts optional q + convertible limit', () => {
      const ok = validate(searchUsersSchema, { q: 'beta', limit: '10', junk: 'x' });
      expect(ok.ok).toBe(true);
    });

    it('rejects oversized or wrong-typed values', () => {
      expect(validate(searchUsersSchema, { q: 'x'.repeat(101) }).ok).toBe(false);
      expect(validate(searchUsersSchema, { limit: 51 }).ok).toBe(false);
      expect(validate(searchUsersSchema, { limit: 'many' }).ok).toBe(false);
    });
  });

  describe('queryChatSchema', () => {
    it('converts query strings and clamps range', () => {
      expect(validate(queryChatSchema, { page: '2', limit: '50' }).ok).toBe(true);
      expect(validate(queryChatSchema, { page: '0' }).ok).toBe(false);
      expect(validate(queryChatSchema, { limit: '101' }).ok).toBe(false);
    });
  });
});
