import { createToolSchema } from '../src/modules/tools/dto/create-tool.dto';
import { updateToolSchema } from '../src/modules/tools/dto/update-tool.dto';
import { queryToolsSchema } from '../src/modules/tools/dto/query-tools.dto';

/** Same contract as JoiValidationPipe (abortEarly off, unknown keys stripped). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validate = (schema: { validate: (v: unknown, o?: object) => { error?: any; value: any } }, value: unknown) =>
  schema.validate(value, { abortEarly: false, allowUnknown: false, stripUnknown: true, convert: true });

describe('createToolSchema', () => {
  it('fills defaults and trims name', () => {
    const { error, value } = validate(createToolSchema, {
      name: '  Notepad++  ',
      downloadLink: 'https://example.com/npp',
    });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      name: 'Notepad++',
      description: null,
      downloadLink: 'https://example.com/npp',
    });
  });

  it('treats an empty description as null', () => {
    const { error, value } = validate(createToolSchema, {
      name: 't',
      description: '',
      downloadLink: 'https://example.com/t',
    });
    expect(error).toBeUndefined();
    expect(value.description).toBeNull();
  });

  it('accepts explicit null description', () => {
    const { error } = validate(createToolSchema, {
      name: 't',
      description: null,
      downloadLink: 'https://example.com/t',
    });
    expect(error).toBeUndefined();
  });

  it('requires name and downloadLink', () => {
    expect(validate(createToolSchema, { downloadLink: 'https://x.dev/a' }).error).toBeDefined();
    expect(validate(createToolSchema, { name: 't' }).error).toBeDefined();
    expect(validate(createToolSchema, {}).error).toBeDefined();
  });

  it('rejects invalid download links (not a URL, wrong scheme, empty, oversized)', () => {
    expect(
      validate(createToolSchema, { name: 't', downloadLink: 'not-a-url' }).error,
    ).toBeDefined();
    expect(
      validate(createToolSchema, { name: 't', downloadLink: 'example.com/file.exe' }).error,
    ).toBeDefined();
    expect(
      validate(createToolSchema, { name: 't', downloadLink: 'ftp://example.com/file' }).error,
    ).toBeDefined();
    expect(validate(createToolSchema, { name: 't', downloadLink: '' }).error).toBeDefined();
    expect(
      validate(createToolSchema, { name: 't', downloadLink: `https://x.dev/${'a'.repeat(2100)}` })
        .error,
    ).toBeDefined();
  });

  it('accepts http and https URLs (with paths/queries)', () => {
    for (const link of [
      'https://example.com/tool.zip?version=2',
      'http://localhost:3000/download/tool',
    ]) {
      expect(validate(createToolSchema, { name: 't', downloadLink: link }).error).toBeUndefined();
    }
  });

  it('rejects empty/oversized name and unknown keys', () => {
    expect(validate(createToolSchema, { name: '', downloadLink: 'https://x.dev/a' }).error).toBeDefined();
    expect(
      validate(createToolSchema, { name: 'x'.repeat(256), downloadLink: 'https://x.dev/a' }).error,
    ).toBeDefined();
    const stripped = validate(createToolSchema, { name: 't', downloadLink: 'https://x.dev/a', hacker: 'yes' });
    expect(stripped.error).toBeUndefined();
    expect((stripped.value as Record<string, unknown>).hacker).toBeUndefined();
  });
});

describe('updateToolSchema', () => {
  it('accepts any subset of fields (no hidden defaults)', () => {
    for (const body of [
      { name: 'renamed' },
      { description: 'updated' },
      { downloadLink: 'https://updated.dev/f' },
    ]) {
      const { error, value } = validate(updateToolSchema, body);
      expect(error).toBeUndefined();
      expect(Object.keys(value)).toContain(Object.keys(body)[0]);
    }
    // empty patch stays empty → service rejects it as 400
    expect(Object.keys(validate(updateToolSchema, {}).value)).toHaveLength(0);
  });

  it('rejects invalid values', () => {
    expect(validate(updateToolSchema, { name: '   ' }).error).toBeDefined();
    expect(validate(updateToolSchema, { name: 'x'.repeat(256) }).error).toBeDefined();
    expect(validate(updateToolSchema, { description: 'x'.repeat(5001) }).error).toBeDefined();
    expect(validate(updateToolSchema, { downloadLink: 'javascript:alert(1)' }).error).toBeDefined();
    expect(validate(updateToolSchema, { downloadLink: '//cdn.example/tool' }).error).toBeDefined();
  });
});

describe('queryToolsSchema', () => {
  const valid = (extra: Record<string, unknown> = {}) => validate(queryToolsSchema, extra);

  it('accepts all supported sort/search/pagination params', () => {
    const { error } = valid({ page: 2, limit: 50, search: 'foo', sortBy: 'name', sortOrder: 'asc' });
    expect(error).toBeUndefined();
  });

  it('rejects out-of-range pagination', () => {
    expect(valid({ page: 0 }).error).toBeDefined();
    expect(valid({ limit: 101 }).error).toBeDefined();
    expect(valid({ limit: 'abc' }).error).toBeDefined();
  });

  it('rejects unknown sort fields', () => {
    expect(valid({ sortBy: 'owner' }).error).toBeDefined();
    expect(valid({ sortBy: 'downloadLink' }).error).toBeDefined();
    expect(valid({ sortOrder: 'up' }).error).toBeDefined();
  });

  it('pipes query strings into numbers via convert', () => {
    const { value } = validate(queryToolsSchema, { page: '3', limit: '10' });
    expect(value).toMatchObject({ page: 3, limit: 10 });
  });
});
