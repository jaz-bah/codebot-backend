import { COMPONENT_CODE_MAX_LENGTH } from '../src/modules/components/dto/component.constants';
import { createComponentSchema } from '../src/modules/components/dto/create-component.dto';
import { updateComponentSchema } from '../src/modules/components/dto/update-component.dto';
import { queryComponentsSchema } from '../src/modules/components/dto/query-components.dto';

/** Joi schema contracts for the components module (validation-only, no DB). */

// Same options as JoiValidationPipe (src/common/pipes/joi-validation.pipe.ts).
const opts = { abortEarly: false, stripUnknown: true, convert: true };

const BASE = {
  name: 'alignment',
  preview: '/image-url',
  files: [{ language: 'css', code: 'align:center' }],
};

describe('createComponentSchema', () => {
  const create = (body: Record<string, unknown>) => createComponentSchema.validate(body, opts);

  it('accepts the documented payload shape', () => {
    const { error, value } = create(BASE);
    expect(error).toBeUndefined();
    expect(value).toMatchObject(BASE);
  });

  it('requires name, preview and at least one file', () => {
    for (const body of [
      { preview: '/x', files: BASE.files },
      { name: 'alignment', files: BASE.files },
      { name: 'alignment', preview: '/x' },
      { name: 'alignment', preview: '/x', files: [] },
    ]) {
      expect(create(body).error).toBeDefined();
    }
  });

  it('caps name at 255 chars and rejects empty names', () => {
    expect(create({ ...BASE, name: 'x'.repeat(256) }).error).toBeDefined();
    expect(create({ ...BASE, name: '   ' }).error).toBeDefined();
  });

  it('preview must be an absolute URL or a root-relative path', () => {
    for (const preview of ['https://cdn.example.com/a.png', 'http://x/y.jpg', '/image-url']) {
      expect(create({ ...BASE, preview }).error).toBeUndefined();
    }
    for (const preview of ['image-url', './relative.png', '../up.png', '', 'x'.repeat(1001)]) {
      expect(create({ ...BASE, preview }).error).toBeDefined();
    }
  });

  it('normalizes the language tag to lowercase', () => {
    const { value } = create({ ...BASE, files: [{ language: 'CSS', code: 'x' }] });
    expect(value.files[0].language).toBe('css');
  });

  it('rejects malformed language slugs', () => {
    for (const language of ['a'.repeat(21), 'c/s', '', 'lang name', 'C++', 'A B', 'a;DROP']) {
      expect(create({ ...BASE, files: [{ language, code: 'x' }] }).error).toBeDefined();
    }
  });

  it('caps code at the content limit and rejects missing code/language', () => {
    expect(
      create({ ...BASE, files: [{ language: 'css', code: 'x'.repeat(COMPONENT_CODE_MAX_LENGTH) }] }).error,
    ).toBeUndefined(); // exactly at the cap is fine
    expect(
      create({...BASE, files: [{ language: 'css', code: `a${'x'.repeat(COMPONENT_CODE_MAX_LENGTH)}` }] }).error,
    ).toBeDefined(); // one byte over
    expect(create({ ...BASE, files: [{ language: 'css' }] }).error).toBeDefined();
    expect(create({ ...BASE, files: [{ code: 'x' }] }).error).toBeDefined();
  });

  it('caps files at 20 and strips unknown keys', () => {
    const twenty = Array.from({ length: 20 }, () => ({ language: 'css', code: 'x' }));
    expect(create({ ...BASE, files: twenty }).error).toBeUndefined();
    expect(create({ ...BASE, files: [...twenty, { language: 'css', code: 'x' }] }).error).toBeDefined();

    const { value } = create({ ...BASE, hacked: true, files: [{ language: 'css', code: 'x', owner: 'me' }] });
    expect(value).toMatchObject({ files: [{ language: 'css', code: 'x' }] });
  });
});

describe('updateComponentSchema', () => {
  const update = (body: Record<string, unknown>) => updateComponentSchema.validate(body, opts);

  it('accepts any partial metadata patch', () => {
    expect(update({}).error).toBeUndefined(); // empty-remainder guard is the SERVICE's 400
    expect(update({ name: 'Renamed' }).error).toBeUndefined();
    expect(update({ name: 'Renamed', preview: '/b.png', files: BASE.files }).error).toBeUndefined();
  });

  it('validates the files array when present (full-replace semantics)', () => {
    expect(update({ files: [] }).error).toBeDefined();
    expect(update({ files: [{ language: 'css', code: 'align:center' }] }).error).toBeUndefined();
    expect(update({ files: [{ language: 'C++', code: 'x' }] }).error).toBeDefined();
  });

  it('applies the same preview rules as create', () => {
    expect(update({ preview: '/ok.png' }).error).toBeUndefined();
    expect(update({ preview: 'not-a-path' }).error).toBeDefined();
  });
});

describe('queryComponentsSchema', () => {
  const query = (body: Record<string, unknown>) => queryComponentsSchema.validate(body, opts);

  it('passes through page/limit/search/sort', () => {
    const { error, value } = query({ page: '2', limit: '10', search: 'align', sortBy: 'name', sortOrder: 'asc' });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ page: 2, limit: 10, search: 'align', sortBy: 'name', sortOrder: 'asc' });
  });

  it('lowercases the language filter and keeps only slugs', () => {
    expect(query({ language: 'CSS' }).value.language).toBe('css');
    expect(query({ language: 'C++' }).error).toBeDefined();
  });

  it('rejects invalid pagination/sort values', () => {
    for (const q of [{ page: 0 }, { limit: 101 }, { sortBy: 'language' }, { sortOrder: 'ASC' }]) {
      expect(query(q).error).toBeDefined();
    }
  });
});
