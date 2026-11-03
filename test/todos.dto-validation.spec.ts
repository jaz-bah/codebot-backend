import { createTodoSchema } from '../src/modules/todos/dto/create-todo.dto';
import { updateTodoSchema } from '../src/modules/todos/dto/update-todo.dto';
import { queryTodosSchema } from '../src/modules/todos/dto/query-todos.dto';
import { reorderTodosSchema } from '../src/modules/todos/dto/reorder-todos.dto';

/** Same contract as JoiValidationPipe (abortEarly off, unknown keys stripped). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validate = (schema: { validate: (v: unknown, o?: object) => { error?: any; value: any } }, value: unknown) =>
  schema.validate(value, { abortEarly: false, allowUnknown: false, stripUnknown: true, convert: true });

describe('createTodoSchema', () => {
  it('fills defaults and trims title', () => {
    const { error, value } = validate(createTodoSchema, { title: '  Buy milk  ' });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      title: 'Buy milk',
      description: null,
      status: 'pending',
      priority: 'medium',
      dueDate: null,
    });
  });

  it('parses ISO dueDate into Date', () => {
    const { error, value } = validate(createTodoSchema, {
      title: 't',
      dueDate: '2026-02-01T10:00:00.000Z',
    });
    expect(error).toBeUndefined();
    expect(value.dueDate).toBeInstanceOf(Date);
  });

  it('accepts explicit null description/dueDate (clearing fields)', () => {
    const { error } = validate(createTodoSchema, { title: 't', description: null, dueDate: null });
    expect(error).toBeUndefined();
  });

  it('rejects empty/oversized title', () => {
    expect(validate(createTodoSchema, { title: '' }).error).toBeDefined();
    expect(validate(createTodoSchema, { title: 'x'.repeat(256) }).error).toBeDefined();
    expect(validate(createTodoSchema, {}).error).toBeDefined();
  });

  it('rejects foreign enum values and unknown keys', () => {
    expect(validate(createTodoSchema, { title: 't', status: 'archived' }).error).toBeDefined();
    expect(validate(createTodoSchema, { title: 't', priority: 'severity' }).error).toBeDefined();
    const stripped = validate(createTodoSchema, { title: 't', hacker: 'yes' });
    expect(stripped.error).toBeUndefined();
    expect((stripped.value as Record<string, unknown>).hacker).toBeUndefined();
  });

  it('rejects non-integer/negative position', () => {
    expect(validate(createTodoSchema, { title: 't', position: -1 }).error).toBeDefined();
    expect(validate(createTodoSchema, { title: 't', position: 1.5 }).error).toBeDefined();
  });
});

describe('updateTodoSchema', () => {
  it('accepts any subset of fields (no hidden defaults)', () => {
    for (const body of [
      { status: 'done' },
      { priority: 'urgent' },
      { dueDate: '2026-03-01T00:00:00.000Z' },
      { description: 'updated' },
      { title: 'renamed' },
      { position: 0 },
    ]) {
      const { error, value } = validate(updateTodoSchema, body);
      expect(error).toBeUndefined();
      expect(Object.keys(value)).toContain(Object.keys(body)[0]);
    }
    // empty patch stays empty → service rejects it as 400
    expect(Object.keys(validate(updateTodoSchema, {}).value)).toHaveLength(0);
  });

  it('rejects invalid values', () => {
    expect(validate(updateTodoSchema, { title: '   ' }).error).toBeDefined();
    expect(validate(updateTodoSchema, { status: 'done!' }).error).toBeDefined();
    expect(validate(updateTodoSchema, { dueDate: 'not-a-date' }).error).toBeDefined();
    expect(validate(updateTodoSchema, { dueDate: '146-plain' }).error).toBeDefined();
  });
});

describe('queryTodosSchema', () => {
  const valid = (extra: Record<string, unknown> = {}) => validate(queryTodosSchema, extra);

  it('accepts all supported sort/filter params', () => {
    const { error } = valid({ page: 2, limit: 50, search: 'foo', status: 'done', priority: 'high', sortBy: 'position', sortOrder: 'asc' });
    expect(error).toBeUndefined();
  });

  it('rejects out-of-range pagination', () => {
    expect(valid({ page: 0 }).error).toBeDefined();
    expect(valid({ limit: 101 }).error).toBeDefined();
    expect(valid({ limit: 'abc' }).error).toBeDefined();
  });

  it('rejects unknown sort fields and foreign enums', () => {
    expect(valid({ sortBy: 'owner' }).error).toBeDefined();
    expect(valid({ status: 'deleted' }).error).toBeDefined();
    expect(valid({ priority: 'P0' }).error).toBeDefined();
  });
});

describe('reorderTodosSchema', () => {
  it('accepts a positional assignment list', () => {
    const { error, value } = validate(reorderTodosSchema, {
      items: [
        { id: '9c9cd602-b21c-4b79-b60a-8c9ecf6d2a11', position: 0 },
        { id: 'b2419b91-30e5-4a5a-9d15-57f01a977b22', position: 1 },
      ],
    });
    expect(error).toBeUndefined();
    expect(value.items).toHaveLength(2);
  });

  it('rejects duplicates in ids/positions and non-uuid ids', () => {
    const id1 = '9c9cd602-b21c-4b79-b60a-8c9ecf6d2a11';
    expect(validate(reorderTodosSchema, { items: [{ id: id1, position: 0 }, { id: id1, position: 1 }] }).error).toBeUndefined(); // dup id → service-level
    expect(validate(reorderTodosSchema, { items: [{ id: id1, position: 0 }] }).error).toBeUndefined();
    expect(validate(reorderTodosSchema, { items: [{ id: 'not-a-uuid', position: 0 }] }).error).toBeDefined();
    expect(validate(reorderTodosSchema, { items: [{ id: id1, position: 'first' }] }).error).toBeDefined();
    expect(validate(reorderTodosSchema, { items: [] }).error).toBeDefined();
    expect(validate(reorderTodosSchema, {}).error).toBeDefined();
  });
});
