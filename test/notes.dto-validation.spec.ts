import {
  createFileSchema,
  MAX_NOTE_CONTENT_LENGTH,
} from '../src/modules/notes/dto/create-file.dto';
import { updateFileSchema } from '../src/modules/notes/dto/update-file.dto';
import { queryFilesSchema } from '../src/modules/notes/dto/query-files.dto';
import { queryNotesSchema } from '../src/modules/notes/dto/query-notes.dto';
import { updateNoteSchema } from '../src/modules/notes/dto/update-note.dto';

/** Joi schema contracts for the notes module (validation-only, no DB). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validate = (schema: { validate: (v: unknown, o?: Record<string, unknown>) => any }) =>
  schema;

describe('createFileSchema', () => {
  const create = (body: Record<string, unknown>) =>
    validate(createFileSchema).validate(body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

  it('accepts a root folder and defaults parentId/content to null', () => {
    const { error, value } = create({ name: 'General', type: 'folder' });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ name: 'General', type: 'folder', parentId: null, content: null });
  });

  it('requires the .html extension for files', () => {
    const bad = create({ name: 'welcome', type: 'file' });
    expect(bad.error).toBeDefined();
    expect(bad.error?.message).toContain('.html');

    const ok = create({ name: 'welcome.html', type: 'file' });
    expect(ok.error).toBeUndefined();
    const upper = create({ name: 'MEETING-NOTES.HTML', type: 'file' });
    expect(upper.error).toBeUndefined();
  });

  it('forbids content on folders', () => {
    const { error } = create({ name: 'General', type: 'folder', content: '<h1>hi</h1>' });
    expect(error).toBeDefined();
  });

  it('keeps rich HTML content for files (up to the 500 KB cap)', () => {
    const { error, value } = create({
      name: 'a.html',
      type: 'file',
      content: '<h2>Team sync</h2><ul><li>ship</li></ul>',
    });
    expect(error).toBeUndefined();
    expect(value.content).toContain('<h2>');
    expect(
      validate(createFileSchema).validate({ name: 'a.html', type: 'file', content: 'x'.repeat(MAX_NOTE_CONTENT_LENGTH + 1) }).error,
    ).toBeDefined();
  });

  it('rejects path separators, control chars, dot names, >255 chars', () => {
    for (const name of ['a/b', 'a\\b', '.\n', '..', 'x'.repeat(256), '\u0007bell']) {
      expect(validate(createFileSchema).validate({ name, type: 'folder' }).error).toBeDefined();
    }
  });

  it('normalizes empty parentId to null and strips unknown fields', () => {
    const { value } = create({ name: 'a.html', type: 'file', parentId: '', hacked: 'x' });
    expect(value.parentId).toBeNull();
    expect(value.hacked).toBeUndefined();
  });
});

describe('updateFileSchema', () => {
  it('both fields optional; at least one known field survives', () => {
    const nothing = validate(updateFileSchema).validate({}, { stripUnknown: true });
    expect(nothing.error).toBeUndefined();
    expect(Object.keys(nothing.value ?? {})).toHaveLength(0);

    const rename = validate(updateFileSchema).validate(
      { name: 'Renamed.html', hacked: 1 },
      { stripUnknown: true },
    );
    expect(rename.error).toBeUndefined();
    expect(rename.value).toEqual({ name: 'Renamed.html' });
  });

  it('rejects path separators and empty names', () => {
    expect(validate(updateFileSchema).validate({ name: 'a/b' }).error).toBeDefined();
    expect(validate(updateFileSchema).validate({ name: '  ' }).error).toBeDefined();
  });

  it('parentId must be a uuid or null (empty string clears it)', () => {
    expect(validate(updateFileSchema).validate({ parentId: 'nope' }).error).toBeDefined();
    const cleared = validate(updateFileSchema).validate({ parentId: '' }, { convert: true });
    expect(cleared.error).toBeUndefined();
    expect(cleared.value.parentId).toBeUndefined(); // empty → omitted (no move)
  });
});

describe('queryFilesSchema', () => {
  it('converts page/limit from strings and clamps nothing (service clamps)', () => {
    const { value, error } = validate(queryFilesSchema).validate(
      { page: '2', limit: '10', sortBy: 'name' },
      { convert: true },
    );
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ page: 2, limit: 10, sortBy: 'name' });
  });

  it('rejects bad enums', () => {
    expect(validate(queryFilesSchema).validate({ sortBy: 'hack' }).error).toBeDefined();
    expect(validate(queryFilesSchema).validate({ type: 'link' }).error).toBeDefined();
    expect(validate(queryFilesSchema).validate({ parentId: 'not-a-uuid' }).error).toBeDefined();
  });
});

describe('queryNotesSchema', () => {
  it('accepts search + folderId + sort', () => {
    const { value, error } = validate(queryNotesSchema).validate(
      { search: 'metrics', folderId: '00000000-0000-4000-8000-000000000001', sortBy: 'fileName', sortOrder: 'asc' },
      { convert: true },
    );
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ sortBy: 'fileName', sortOrder: 'asc' });
  });

  it('rejects unknown sort keys', () => {
    expect(validate(queryNotesSchema).validate({ sortBy: 'content' }).error).toBeDefined();
  });
});

describe('updateNoteSchema', () => {
  it('content required; empty allowed; 500 KB cap enforced', () => {
    expect(validate(updateNoteSchema).validate({ content: '' }).error).toBeUndefined();
    expect(validate(updateNoteSchema).validate({}).error).toBeDefined();
    expect(
      validate(updateNoteSchema).validate({ content: 'x'.repeat(MAX_NOTE_CONTENT_LENGTH + 1) }).error,
    ).toBeDefined();
    expect(
      validate(updateNoteSchema).validate({ content: '<h1>ok</h1>' }).error,
    ).toBeUndefined();
  });
});
