import { createArtboardSchema } from '../src/modules/artboards/dto/create-artboard.dto';
import { updateArtboardSchema } from '../src/modules/artboards/dto/update-artboard.dto';
import { queryArtboardsSchema } from '../src/modules/artboards/dto/query-artboards.dto';
import { MAX_ARTBOARD_CONTENT_LENGTH } from '../src/modules/artboards/dto/content-length.constant';

/** Same contract as JoiValidationPipe (abortEarly off, unknown keys stripped). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validate = (schema: { validate: (v: unknown, o?: object) => { error?: any; value: any } }, value: unknown) =>
  schema.validate(value, { abortEarly: false, allowUnknown: false, stripUnknown: true, convert: true });

describe('createArtboardSchema', () => {
  it('fills default content and trims title', () => {
    const { error, value } = validate(createArtboardSchema, { title: '  My Design  ' });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ title: 'My Design', content: '' });
  });

  it('preserves content formatting byte-exactly (no trim/normalization)', () => {
    const raw = '  {"a": 1}\n\n<div>  x </div>\t✓ é\n';
    const { error, value } = validate(createArtboardSchema, { title: 't', content: raw });
    expect(error).toBeUndefined();
    expect(value.content).toBe(raw); // leading/trailing whitespace AND newlines intact
  });

  it('accepts empty content', () => {
    const { error, value } = validate(createArtboardSchema, { title: 't', content: '' });
    expect(error).toBeUndefined();
    expect(value.content).toBe('');
  });

  it('rejects empty/oversized title', () => {
    expect(validate(createArtboardSchema, { title: '' }).error).toBeDefined();
    expect(validate(createArtboardSchema, { title: 'x'.repeat(256) }).error).toBeDefined();
    expect(validate(createArtboardSchema, {}).error).toBeDefined();
  });

  it('rejects oversized content and strips unknown keys', () => {
    expect(
      validate(createArtboardSchema, { title: 't', content: 'x'.repeat(MAX_ARTBOARD_CONTENT_LENGTH + 1) })
        .error,
    ).toBeDefined();
    const stripped = validate(createArtboardSchema, { title: 't', hacker: 'yes' });
    expect(stripped.error).toBeUndefined();
    expect((stripped.value as Record<string, unknown>).hacker).toBeUndefined();
  });
});

describe('updateArtboardSchema', () => {
  it('accepts any subset of fields (no hidden defaults)', () => {
    for (const body of [{ title: 'renamed' }, { content: 'updated' }, { content: '' }]) {
      const { error, value } = validate(updateArtboardSchema, body);
      expect(error).toBeUndefined();
      expect(Object.keys(value)).toContain(Object.keys(body)[0]);
    }
    // empty patch stays empty → service rejects it as 400
    expect(Object.keys(validate(updateArtboardSchema, {}).value)).toHaveLength(0);
  });

  it('preserves content formatting byte-exactly', () => {
    const raw = 'line1\n  indented\n\ttabbed ✨';
    const { error, value } = validate(updateArtboardSchema, { content: raw });
    expect(error).toBeUndefined();
    expect(value.content).toBe(raw);
  });

  it('rejects invalid values', () => {
    expect(validate(updateArtboardSchema, { title: '   ' }).error).toBeDefined();
    expect(validate(updateArtboardSchema, { title: 'x'.repeat(256) }).error).toBeDefined();
    expect(
      validate(updateArtboardSchema, { content: 'x'.repeat(MAX_ARTBOARD_CONTENT_LENGTH + 1) }).error,
    ).toBeDefined();
  });
});

describe('queryArtboardsSchema', () => {
  const valid = (extra: Record<string, unknown> = {}) => validate(queryArtboardsSchema, extra);

  it('accepts all supported params', () => {
    const { error } = valid({ page: 2, limit: 50, search: 'foo', sortBy: 'title', sortOrder: 'asc' });
    expect(error).toBeUndefined();
  });

  it('rejects out-of-range pagination', () => {
    expect(valid({ page: 0 }).error).toBeDefined();
    expect(valid({ limit: 101 }).error).toBeDefined();
    expect(valid({ limit: 'abc' }).error).toBeDefined();
  });

  it('rejects unknown sort fields and orderings', () => {
    expect(valid({ sortBy: 'content' }).error).toBeDefined();
    expect(valid({ sortBy: 'owner' }).error).toBeDefined();
    expect(valid({ sortOrder: 'up' }).error).toBeDefined();
  });
});
