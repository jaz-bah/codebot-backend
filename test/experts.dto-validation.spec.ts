import { createExpertSchema } from '../src/modules/experts/dto/create-expert.dto';
import { updateExpertSchema } from '../src/modules/experts/dto/update-expert.dto';
import { queryExpertsSchema } from '../src/modules/experts/dto/query-experts.dto';

/** Same contract as JoiValidationPipe (abortEarly off, unknown keys stripped). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validate = (schema: { validate: (v: unknown, o?: object) => { error?: any; value: any } }, value: unknown) =>
  schema.validate(value, { abortEarly: false, allowUnknown: false, stripUnknown: true, convert: true });

describe('createExpertSchema', () => {
  it('fills defaults and trims title', () => {
    const { error, value } = validate(createExpertSchema, { title: '  Ada Lovelace  ' });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ title: 'Ada Lovelace', description: null });
  });

  it('treats an empty description as null', () => {
    const { error, value } = validate(createExpertSchema, { title: 't', description: '' });
    expect(error).toBeUndefined();
    expect(value.description).toBeNull();
  });

  it('accepts explicit null description', () => {
    const { error } = validate(createExpertSchema, { title: 't', description: null });
    expect(error).toBeUndefined();
  });

  it('rejects empty/oversized title', () => {
    expect(validate(createExpertSchema, { title: '' }).error).toBeDefined();
    expect(validate(createExpertSchema, { title: 'x'.repeat(256) }).error).toBeDefined();
    expect(validate(createExpertSchema, {}).error).toBeDefined();
  });

  it('rejects oversized descriptions and unknown keys', () => {
    expect(validate(createExpertSchema, { title: 't', description: 'x'.repeat(5001) }).error).toBeDefined();
    const stripped = validate(createExpertSchema, { title: 't', hacker: 'yes' });
    expect(stripped.error).toBeUndefined();
    expect((stripped.value as Record<string, unknown>).hacker).toBeUndefined();
  });
});

describe('updateExpertSchema', () => {
  it('accepts any subset of fields (no hidden defaults)', () => {
    for (const body of [{ title: 'renamed' }, { description: 'updated' }]) {
      const { error, value } = validate(updateExpertSchema, body);
      expect(error).toBeUndefined();
      expect(Object.keys(value)).toContain(Object.keys(body)[0]);
    }
    // empty patch stays empty → service rejects it as 400
    expect(Object.keys(validate(updateExpertSchema, {}).value)).toHaveLength(0);
  });

  it('rejects invalid values', () => {
    expect(validate(updateExpertSchema, { title: '   ' }).error).toBeDefined();
    expect(validate(updateExpertSchema, { title: 'x'.repeat(256) }).error).toBeDefined();
    expect(validate(updateExpertSchema, { description: 'x'.repeat(5001) }).error).toBeDefined();
  });
});

describe('queryExpertsSchema', () => {
  const valid = (extra: Record<string, unknown> = {}) => validate(queryExpertsSchema, extra);

  it('accepts all supported sort/search/pagination params', () => {
    const { error } = valid({ page: 2, limit: 50, search: 'foo', sortBy: 'title', sortOrder: 'asc' });
    expect(error).toBeUndefined();
  });

  it('rejects out-of-range pagination', () => {
    expect(valid({ page: 0 }).error).toBeDefined();
    expect(valid({ limit: 101 }).error).toBeDefined();
    expect(valid({ limit: 'abc' }).error).toBeDefined();
  });

  it('rejects unknown sort fields', () => {
    expect(valid({ sortBy: 'owner' }).error).toBeDefined();
    expect(valid({ sortBy: 'description' }).error).toBeDefined();
    expect(valid({ sortOrder: 'up' }).error).toBeDefined();
  });

  it('pipes query strings into numbers via convert', () => {
    const { value } = validate(queryExpertsSchema, { page: '3', limit: '10' });
    expect(value).toMatchObject({ page: 3, limit: 10 });
  });
});
