import { createPostSchema } from '../src/modules/posts/dto/create-post.dto';
import { updatePostSchema } from '../src/modules/posts/dto/update-post.dto';
import { queryPostsSchema } from '../src/modules/posts/dto/query-posts.dto';

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

describe('posts DTO validation', () => {
  describe('createPostSchema', () => {
    it('accepts a valid publish payload with defaults applied', () => {
      const out = validate(createPostSchema, {
        resourceType: 'note',
        resourceId: '0b9e6c50-1f2e-4a3c-8d5b-2a1f3e4c5b6a',
        title: '  My note  ',
      });
      expect(out.ok).toBe(true);
      // title trims, description defaults to null
      expect(out.value).toMatchObject({
        resourceType: 'note',
        title: 'My note',
        description: null,
      });
    });

    it('accepts every declared resource type', () => {
      for (const resourceType of ['todo', 'note', 'component', 'preset', 'tool', 'snippet']) {
        expect(
          validate(createPostSchema, {
            resourceType,
            resourceId: '0b9e6c50-1f2e-4a3c-8d5b-2a1f3e4c5b6a',
            title: 't',
          }).ok,
        ).toBe(true);
      }
    });

    it('rejects unknown resource types (no free-form types)', () => {
      expect(
        validate(createPostSchema, {
          resourceType: 'workspace-secret',
          resourceId: '0b9e6c50-1f2e-4a3c-8d5b-2a1f3e4c5b6a',
          title: 't',
        }).ok,
      ).toBe(false);
    });

    it('rejects missing/non-uuid resourceId', () => {
      expect(validate(createPostSchema, { resourceType: 'todo', title: 't' }).ok).toBe(false);
      expect(
        validate(createPostSchema, { resourceType: 'todo', resourceId: 'not-a-uuid', title: 't' }).ok,
      ).toBe(false);
    });

    it('rejects empty/oversized title and oversized description', () => {
      const base = {
        resourceType: 'tool',
        resourceId: '0b9e6c50-1f2e-4a3c-8d5b-2a1f3e4c5b6a',
      };
      expect(validate(createPostSchema, { ...base, title: '' }).ok).toBe(false);
      expect(validate(createPostSchema, { ...base, title: 'x'.repeat(201) }).ok).toBe(false);
      expect(validate(createPostSchema, { ...base, title: 't', description: 'x'.repeat(2001) }).ok).toBe(
        false,
      );
    });

    it('strips unknown keys and forbids client-chosen authorship', () => {
      const out = validate(createPostSchema, {
        resourceType: 'todo',
        resourceId: '0b9e6c50-1f2e-4a3c-8d5b-2a1f3e4c5b6a',
        title: 't',
        userId: 'attacker-id',
        voteCount: 999,
      } as never);
      expect(Object.keys(out.value ?? {}).sort()).toEqual(['description', 'resourceId', 'resourceType', 'title']);
    });
  });

  describe('updatePostSchema', () => {
    it('requires at least one updatable field', () => {
      expect(validate(updatePostSchema, {}).ok).toBe(false);
      expect(validate(updatePostSchema, { title: 'new title' }).ok).toBe(true);
      expect(validate(updatePostSchema, { description: 'reworded' }).ok).toBe(true);
      expect(validate(updatePostSchema, { title: 'renamed post', description: null }).ok).toBe(true);
    });

    it('rejects oversized values', () => {
      expect(validate(updatePostSchema, { title: 'x'.repeat(201) }).ok).toBe(false);
      expect(validate(updatePostSchema, { description: 'x'.repeat(2001) }).ok).toBe(false);
    });

    it('never allows re-pointing the post at another resource', () => {
      const out = validate(updatePostSchema, { resourceType: 'note', resourceId: 'hacked' } as never);
      expect(Object.keys(out.value ?? {})).toEqual([]);
    });
  });

  describe('queryPostsSchema', () => {
    it('converts query strings and validates ranges', () => {
      const out = validate(queryPostsSchema, { page: '2', limit: '50' });
      expect(out.ok).toBe(true);
      expect(out.value).toMatchObject({ page: 2, limit: 50 });
      expect(validate(queryPostsSchema, { page: '0' }).ok).toBe(false);
      expect(validate(queryPostsSchema, { limit: '101' }).ok).toBe(false);
    });

    it('accepts every filter/sort combination from the contract', () => {
      expect(
        validate(queryPostsSchema, {
          search: 'tailwind',
          resourceType: 'component',
          sortBy: 'votes',
          sortOrder: 'asc',
        }).ok,
      ).toBe(true);
    });

    it('rejects unknown resourceType and sort keys', () => {
      expect(validate(queryPostsSchema, { resourceType: 'files' }).ok).toBe(false);
      expect(validate(queryPostsSchema, { sortBy: 'position' }).ok).toBe(false);
    });
  });
});
