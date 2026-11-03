import { createIdeSnippetSchema } from '../src/modules/ide-snippets/dto/create-ide-snippet.dto';
import { updateIdeSnippetSchema } from '../src/modules/ide-snippets/dto/update-ide-snippet.dto';
import { queryIdeSnippetsSchema } from '../src/modules/ide-snippets/dto/query-ide-snippets.dto';

/** Same contract as JoiValidationPipe (abortEarly off, unknown keys stripped). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validate = (schema: { validate: (v: unknown, o?: object) => { error?: any; value: any } }, value: unknown) =>
  schema.validate(value, { abortEarly: false, allowUnknown: false, stripUnknown: true, convert: true });

describe('createIdeSnippetSchema', () => {
  it('trims language but leaves data byte-exact (no trim)', () => {
    const { error, value } = validate(createIdeSnippetSchema, {
      language: '  css  ',
      data: '.css {\n  align: center;\n}\n  ',
    });
    expect(error).toBeUndefined();
    expect(value.language).toBe('css');
    expect(value.data).toBe('.css {\n  align: center;\n}\n  '); // whitespace preserved
  });

  it('preserves line breaks, tabs and special characters in data', () => {
    const code = '\tconst r = 100%;\n// \\ path &_ \n';
    const { error, value } = validate(createIdeSnippetSchema, { language: 'ts', data: code });
    expect(error).toBeUndefined();
    expect(value.data).toBe(code);
  });

  it('requires both language and data', () => {
    expect(validate(createIdeSnippetSchema, { data: '.a{}' }).error).toBeDefined();
    expect(validate(createIdeSnippetSchema, { language: 'css' }).error).toBeDefined();
    expect(validate(createIdeSnippetSchema, {}).error).toBeDefined();
  });

  it('rejects empty data (including whitespace-only) and empty language', () => {
    expect(validate(createIdeSnippetSchema, { language: 'css', data: '' }).error).toBeDefined();
    expect(validate(createIdeSnippetSchema, { language: ' ', data: 'x' }).error).toBeDefined();
  });

  it('rejects oversized data/language and strips unknown keys', () => {
    expect(
      validate(createIdeSnippetSchema, { language: 'css', data: 'x'.repeat(20001) }).error,
    ).toBeDefined();
    expect(
      validate(createIdeSnippetSchema, { language: 'l'.repeat(51), data: 'x' }).error,
    ).toBeDefined();
    const stripped = validate(createIdeSnippetSchema, { language: 'css', data: 'x', hacker: 'yes' });
    expect(stripped.error).toBeUndefined();
    expect((stripped.value as Record<string, unknown>).hacker).toBeUndefined();
  });
});

describe('updateIdeSnippetSchema', () => {
  it('accepts any subset of fields (no hidden defaults)', () => {
    for (const body of [{ language: 'js' }, { data: 'a\nb' }]) {
      const { error, value } = validate(updateIdeSnippetSchema, body);
      expect(error).toBeUndefined();
      expect(Object.keys(value)).toContain(Object.keys(body)[0]);
    }
    // empty patch stays empty → service rejects it as 400
    expect(Object.keys(validate(updateIdeSnippetSchema, {}).value)).toHaveLength(0);
  });

  it('keeps data verbatim on patch too', () => {
    const { error, value } = validate(updateIdeSnippetSchema, { data: '  keep   \n' });
    expect(error).toBeUndefined();
    expect(value.data).toBe('  keep   \n');
  });

  it('rejects invalid values', () => {
    expect(validate(updateIdeSnippetSchema, { language: '   ' }).error).toBeDefined();
    expect(validate(updateIdeSnippetSchema, { language: 'l'.repeat(51) }).error).toBeDefined();
    expect(validate(updateIdeSnippetSchema, { data: '' }).error).toBeDefined();
    expect(validate(updateIdeSnippetSchema, { data: 'x'.repeat(20001) }).error).toBeDefined();
  });
});

describe('queryIdeSnippetsSchema', () => {
  const valid = (extra: Record<string, unknown> = {}) => validate(queryIdeSnippetsSchema, extra);

  it('accepts all supported filter/search/sort/pagination params', () => {
    const { error } = valid({ page: 2, limit: 50, search: 'align', language: 'css', sortBy: 'language', sortOrder: 'asc' });
    expect(error).toBeUndefined();
  });

  it('rejects out-of-range pagination', () => {
    expect(valid({ page: 0 }).error).toBeDefined();
    expect(valid({ limit: 101 }).error).toBeDefined();
    expect(valid({ limit: 'abc' }).error).toBeDefined();
  });

  it('rejects unknown sort fields and blank language filter', () => {
    expect(valid({ sortBy: 'data' }).error).toBeDefined();
    expect(valid({ sortBy: 'owner' }).error).toBeDefined();
    expect(valid({ sortOrder: 'up' }).error).toBeDefined();
    expect(valid({ language: '' }).error).toBeDefined();
    expect(valid({ language: 'l'.repeat(51) }).error).toBeDefined();
  });

  it('pipes query strings into numbers via convert', () => {
    const { value } = validate(queryIdeSnippetsSchema, { page: '3', limit: '10' });
    expect(value).toMatchObject({ page: 3, limit: 10 });
  });
});
