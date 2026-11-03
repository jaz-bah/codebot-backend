import { createPresetSchema } from '../src/modules/presets/dto/create-preset.dto';
import { updatePresetSchema } from '../src/modules/presets/dto/update-preset.dto';
import { queryPresetsSchema } from '../src/modules/presets/dto/query-presets.dto';

/** Same contract as JoiValidationPipe (abortEarly off, unknown keys stripped). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validate = (schema: { validate: (v: unknown, o?: object) => { error?: any; value: any } }, value: unknown) =>
  schema.validate(value, { abortEarly: false, allowUnknown: false, stripUnknown: true, convert: true });

describe('createPresetSchema', () => {
  it('fills defaults, trims name/language, leaves data byte-exact', () => {
    const { error, value } = validate(createPresetSchema, {
      name: '  alignment  ',
      language: '  css  ',
      data: '.css {\n  align: center;\n}\n  ',
    });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ name: 'alignment', language: 'css' });
    expect(value.data).toBe('.css {\n  align: center;\n}\n  '); // whitespace preserved
  });

  it('preserves line breaks, tabs and special characters in data', () => {
    const code = '\tconst r = 100%;\n// \\ path &_ \n';
    const { error, value } = validate(createPresetSchema, {
      name: 't',
      language: 'ts',
      data: code,
    });
    expect(error).toBeUndefined();
    expect(value.data).toBe(code);
  });

  it('requires name, language and data', () => {
    expect(validate(createPresetSchema, { language: 'css', data: '.a{}' }).error).toBeDefined();
    expect(validate(createPresetSchema, { name: 't', data: '.a{}' }).error).toBeDefined();
    expect(validate(createPresetSchema, { name: 't', language: 'css' }).error).toBeDefined();
    expect(validate(createPresetSchema, {}).error).toBeDefined();
  });

  it('rejects empty data (including whitespace-only) and empty fields', () => {
    expect(validate(createPresetSchema, { name: '', language: 'css', data: 'x' }).error).toBeDefined();
    expect(validate(createPresetSchema, { name: 't', language: ' ', data: 'x' }).error).toBeDefined();
    expect(validate(createPresetSchema, { name: 't', language: 'css', data: '' }).error).toBeDefined();
  });

  it('rejects oversized fields and strips unknown keys', () => {
    expect(
      validate(createPresetSchema, { name: 'x'.repeat(256), language: 'css', data: 'x' }).error,
    ).toBeDefined();
    expect(
      validate(createPresetSchema, { name: 't', language: 'l'.repeat(51), data: 'x' }).error,
    ).toBeDefined();
    expect(
      validate(createPresetSchema, { name: 't', language: 'css', data: 'x'.repeat(20001) }).error,
    ).toBeDefined();
    const stripped = validate(createPresetSchema, { name: 't', language: 'css', data: 'x', hacker: 'yes' });
    expect(stripped.error).toBeUndefined();
    expect((stripped.value as Record<string, unknown>).hacker).toBeUndefined();
  });
});

describe('updatePresetSchema', () => {
  it('accepts any subset of fields (no hidden defaults)', () => {
    for (const body of [
      { name: 'renamed' },
      { language: 'js' },
      { data: 'a\nb' },
      { language: '  spaced  ' },
    ]) {
      const { error, value } = validate(updatePresetSchema, body);
      expect(error).toBeUndefined();
      expect(Object.keys(value)).toContain(Object.keys(body)[0]);
    }
    // empty patch stays empty → service rejects it as 400
    expect(Object.keys(validate(updatePresetSchema, {}).value)).toHaveLength(0);
  });

  it('keeps data verbatim on patch too', () => {
    const { error, value } = validate(updatePresetSchema, { data: '  keep   \n' });
    expect(error).toBeUndefined();
    expect(value.data).toBe('  keep   \n');
  });

  it('rejects invalid values', () => {
    expect(validate(updatePresetSchema, { name: '   ' }).error).toBeDefined();
    expect(validate(updatePresetSchema, { name: 'x'.repeat(256) }).error).toBeDefined();
    expect(validate(updatePresetSchema, { language: '' }).error).toBeDefined();
    expect(validate(updatePresetSchema, { data: '' }).error).toBeDefined();
    expect(validate(updatePresetSchema, { data: 'x'.repeat(20001) }).error).toBeDefined();
  });
});

describe('queryPresetsSchema', () => {
  const valid = (extra: Record<string, unknown> = {}) => validate(queryPresetsSchema, extra);

  it('accepts all supported filter/search/sort/pagination params', () => {
    const { error } = valid({ page: 2, limit: 50, search: 'align', language: 'css', sortBy: 'name', sortOrder: 'asc' });
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
    const { value } = validate(queryPresetsSchema, { page: '3', limit: '10' });
    expect(value).toMatchObject({ page: 3, limit: 10 });
  });
});
