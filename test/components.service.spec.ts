import { ComponentsService } from '../src/modules/components/components.service';
import { Component } from '../src/database/typeorm/entities/component.entity';
import { ComponentFile } from '../src/database/typeorm/entities/component-file.entity';
import type { CreateComponentDto } from '../src/modules/components/dto/create-component.dto';

/**
 * ComponentsService unit tests against hand-rolled fakes (same style as
 * todos/notes/documents service specs) — transactional create/file-set
 * replace, verbatim code, ownership scoping, pagination + language filter
 * query shape, batched file loading (no N+1).
 */

interface ComponentRow {
  id: string;
  userId: string;
  name: string;
  preview: string;
  updatedAt?: unknown;
  [k: string]: unknown;
}

interface FileRow {
  id: string;
  componentId: string;
  userId: string;
  language: string;
  code: string;
  createdAt: Date;
  [k: string]: unknown;
}

/** Fake qb that records every step and applies the IN(:...ids) file filter. */
class FakeQb {
  tracker: string[] = [];
  bindings: Record<string, unknown> = {};
  private isClone = false;
  constructor(private readonly repo: FakeRepo) {}

  where(sql: string, bindings?: Record<string, unknown>): FakeQb {
    this.bindings = { ...this.bindings, ...(bindings ?? {}) };
    this.tracker.push(`where(${sql})`);
    return this;
  }
  andWhere(sql: string, bindings?: Record<string, unknown>): FakeQb {
    this.bindings = { ...this.bindings, ...(bindings ?? {}) };
    this.tracker.push(`andWhere(${sql})`);
    this.filters.push(sql);
    return this;
  }
  filters: string[] = [];
  clone(): FakeQb {
    this.tracker.push('clone');
    const clone = new FakeQb(this.repo);
    clone.isClone = true;
    clone.bindings = this.bindings;
    this.repo.lastClone = clone;
    return clone;
  }
  select(...args: unknown[]): FakeQb {
    this.tracker.push(`select(${args[0]})`);
    return this;
  }
  orderBy(...args: unknown[]): FakeQb {
    this.tracker.push(`orderBy(${args.join(' ')})`);
    return this;
  }
  addOrderBy(...args: unknown[]): FakeQb {
    this.tracker.push(`addOrderBy(${args.join(' ')})`);
    return this;
  }
  skip(v: number): FakeQb {
    this.tracker.push(`skip(${v})`);
    return this;
  }
  take(v: number): FakeQb {
    this.tracker.push(`take(${v})`);
    return this;
  }
  async getMany(): Promise<unknown[]> {
    // The file loader filters `componentId IN (:...ids)` + userId in memory.
    const ids = this.bindings.ids as string[] | undefined;
    const userId = this.bindings.userId;
    let rows = this.repo.rows;
    if (ids && this.tracker.some((t) => t.startsWith('where(f.componentId IN'))) {
      rows = (rows as FileRow[]).filter(
        (row) => ids.includes(row.componentId) && row.userId === userId,
      );
    }
    return rows;
  }
  async getRawOne<T>(): Promise<T | undefined> {
    return { cnt: this.repo.rows.length } as unknown as T;
  }
}

class FakeRepo {
  rows: unknown[] = [];
  qb = new FakeQb(this);
  lastClone?: FakeQb;
  createCalls: unknown[] = [];
  updateCalls: unknown[][] = [];
  deleteCalls: unknown[] = [];
  savedAfterDelete = 0;
  private nextId = 1;

  createQueryBuilder(): FakeQb {
    return this.qb;
  }

  create(seed: Record<string, unknown>): unknown {
    this.createCalls.push(seed);
    if ((seed as FileRow).componentId !== undefined) {
      return { id: `cf-${this.nextId++}`, createdAt: new Date(), ...seed };
    }
    return { id: `c-${this.nextId++}`, createdAt: new Date(), ...seed };
  }

  async save(row: unknown): Promise<unknown> {
    this.savedAfterDelete++;
    // TypeORM save() accepts a single entity or an array of entities.
    if (Array.isArray(row)) this.rows.push(...row);
    else this.rows.push(row);
    return row;
  }

  async findOneBy<T extends Record<string, unknown>>(criteria: T): Promise<unknown | null> {
    return (
      (this.rows as Array<Record<string, unknown>>).find((row) =>
        Object.entries(criteria).every(([key, value]) => row[key] === value),
      ) ?? null
    );
  }

  async update(criteria: Record<string, unknown>, patch: Record<string, unknown>): Promise<void> {
    this.updateCalls.push([criteria, patch]);
    for (const row of this.rows as Array<Record<string, unknown>>) {
      if (Object.entries(criteria).every(([key, value]) => row[key] === value)) {
        Object.assign(row, patch, {
          updatedAt: typeof patch.updatedAt === 'function' ? 'NOW()' : patch.updatedAt,
        });
      }
    }
  }

  async delete(criteria: Record<string, unknown>): Promise<void> {
    this.deleteCalls.push(criteria);
    this.rows = (this.rows as Array<Record<string, unknown>>).filter(
      (row) => !Object.entries(criteria).every(([key, value]) => row[key] === value),
    );
  }
}

const makeDeps = () => {
  const components = new FakeRepo();
  const files = new FakeRepo();
  const reposFor = (cls: unknown) =>
    (cls === Component ? components : files) as unknown as never;
  const testEm = {
    getRepository: (cls: unknown) => reposFor(cls),
  };
  const dataSource = {
    isInitialized: true,
    initialize: jest.fn(),
    getRepository: (cls: unknown) => reposFor(cls),
    transaction: async <T>(cb: (em: typeof testEm) => Promise<T>): Promise<T> => cb(testEm),
  };
  const svc = new ComponentsService(dataSource as never);
  return { svc, components, files };
};

const makeDto = (over: Partial<CreateComponentDto> = {}): CreateComponentDto => ({
  name: 'alignment',
  preview: '/image-url',
  files: [{ language: 'css', code: 'align:center' }],
  ...over,
});

const FILE_INPUTS = {
  css: { language: 'css', code: 'align:center' },
  html: { language: 'html', code: '<div class="box"></div>' },
};

describe('ComponentsService — create', () => {
  it('persists the component AND its files in ONE transaction (insertion order kept)', async () => {
    const { svc, files } = makeDeps();
    const dto = makeDto({ files: [FILE_INPUTS.css, FILE_INPUTS.html] });

    const result = await svc.create('u1', dto);

    expect(result).toMatchObject({
      userId: 'u1',
      name: 'alignment',
      preview: '/image-url',
    });
    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toMatchObject({ language: 'css', code: 'align:center', userId: 'u1', position: 0 });
    expect(result.files[1]).toMatchObject({ language: 'html', code: '<div class="box"></div>', position: 1 });
    // The same em fed both repositories inside the transaction — one unit.
    expect(files.rows).toHaveLength(2);
    expect((files.createCalls[0] as Record<string, unknown>).componentId).toBe(result.id);
  });

  it('stores code VERBATIM — formatting survives the round-trip untouched', async () => {
    const { svc, files } = makeDeps();
    const code = '  .a {\n        color: red;\n  }\n\n\n';
    await svc.create('u1', makeDto({ files: [{ language: 'css', code }] }));
    expect((files.rows[0] as unknown as FileRow).code).toBe(code);
  });
});

describe('ComponentsService — list', () => {
  it('attaches files to the page components (one batched query, no N+1)', async () => {
    const { svc, components, files } = makeDeps();
    components.rows.push(
      { id: 'c-1', userId: 'u1', name: 'A', preview: '/a' } as ComponentRow,
      { id: 'c-2', userId: 'u1', name: 'B', preview: '/b' } as ComponentRow,
    );
    files.rows.push(
      { id: 'f1', componentId: 'c-1', userId: 'u1', language: 'css', code: 'x', createdAt: new Date(1) } as FileRow,
      { id: 'f2', componentId: 'c-1', userId: 'u1', language: 'html', code: 'y', createdAt: new Date(2) } as FileRow,
      { id: 'f3', componentId: 'c-2', userId: 'u1', language: 'css', code: 'z', createdAt: new Date(3) } as FileRow,
      { id: 'f4', componentId: 'c-1', userId: 'owner', language: 'css', code: 'leak?', createdAt: new Date(4) } as FileRow,
    );

    const page = await svc.list('u1', { page: 1, limit: 20 });

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.items[0].files.map((f) => f.id)).toEqual(['f1', 'f2']); // insertion order
    expect(page.items[1].files.map((f) => f.id)).toEqual(['f3']);
    // The foreign-user file (f4) is excluded by the ownership filter in the
    // batched load; every component of the page got its exact file set.
    // Batched load: exactly ONE IN(:...ids) query, not one per component.
    expect(files.qb.tracker.filter((t) => t.startsWith('where(f.componentId IN'))).toHaveLength(1);
    expect(files.qb.tracker).toContain('orderBy(f.position ASC)');
  });

  it('applies ownership, search and language EXISTS filters and clamps pagination', async () => {
    const { svc, components } = makeDeps();
    await svc.list('u1', {
      search: 'align',
      language: 'css',
      page: 0,
      limit: 5000,
      sortBy: 'name',
      sortOrder: 'desc',
    });

    expect(components.qb.tracker[0]).toBe('where(c.userId = :userId)');
    expect(components.qb.tracker).toContain("andWhere(c.name ILIKE :searchPattern ESCAPE '\\')");
    expect(components.qb.tracker.some((t) => t.includes('EXISTS (SELECT 1 FROM component_file'))).toBe(true);
    expect(components.qb.tracker).toContain('take(100)');
    expect(components.qb.tracker).toContain('skip(0)');
    expect(components.qb.tracker).toContain('orderBy(c.name DESC)');
    // Count runs on the clone with the same filters.
    expect(components.qb.tracker).toContain('clone');
    expect(components.lastClone?.tracker).toContain('select(COUNT(c.id))');
  });
});

describe('ComponentsService — findOne / remove (ownership scoping)', () => {
  it('404 on foreign or missing ids, files attached on success', async () => {
    const { svc, components } = makeDeps();
    components.rows.push({ id: 'c-9', userId: 'u1', name: 'A', preview: '/a' });

    await expect(svc.findOne('u1', 'c-9')).resolves.toMatchObject({ name: 'A' });
    await expect(svc.findOne('someone-else', 'c-9')).rejects.toMatchObject({ status: 404 });
    await expect(svc.findOne('u1', 'missing')).rejects.toMatchObject({ status: 404 });

    await expect(svc.remove('someone-else', 'c-9')).rejects.toMatchObject({ status: 404 });
    await expect(svc.remove('u1', 'c-9')).resolves.toMatchObject({ deleted: true, id: 'c-9' });
    expect(components.rows).toHaveLength(0); // files cascade via FK (DB-level)
  });
});

describe('ComponentsService — update', () => {
  it('rejects an empty patch with 400', async () => {
    const { svc } = makeDeps();
    await expect(svc.update('u1', 'c-1', {})).rejects.toMatchObject({ status: 400 });
  });

  it('patches metadata (DB-clock updatedAt) without touching files', async () => {
    const { svc, components, files } = makeDeps();
    components.rows.push({ id: 'c-1', userId: 'u1', name: 'A', preview: '/a' });
    files.rows.push({ id: 'f1', componentId: 'c-1', userId: 'u1', language: 'css', code: 'x', createdAt: new Date(1) } as FileRow);

    const result = await svc.update('u1', 'c-1', { name: 'Renamed', preview: '/b.png' });

    expect(result.name).toBe('Renamed');
    expect(result.preview).toBe('/b.png');
    expect(result.files.map((f) => f.id)).toEqual(['f1']); // untouched
    expect(components.deleteCalls).toHaveLength(0);
    const [criteria, patch] = components.updateCalls[0];
    expect(criteria).toMatchObject({ id: 'c-1', userId: 'u1' });
    expect(patch).toMatchObject({ name: 'Renamed', preview: '/b.png' });
  });

  it('replaces the whole file set inside the SAME transaction when `files` is present', async () => {
    const { svc, components, files } = makeDeps();
    components.rows.push({ id: 'c-1', userId: 'u1', name: 'A', preview: '/a' });
    files.rows.push(
      { id: 'f1', componentId: 'c-1', userId: 'u1', language: 'css', code: 'old', createdAt: new Date(1) } as FileRow,
    );

    const result = await svc.update('u1', 'c-1', { files: [FILE_INPUTS.css, FILE_INPUTS.html] });

    // old set deleted, new set inserted, ordering preserved
    expect(files.deleteCalls[0]).toMatchObject({ componentId: 'c-1', userId: 'u1' });
    expect(result.files.map((f) => f.language)).toEqual(['css', 'html']);
    expect((result.files[0] as unknown as FileRow).code).toBe('align:center');
  });

  it('404s foreign-owned components — nothing written', async () => {
    const { svc, components, files } = makeDeps();
    components.rows.push({ id: 'c-1', userId: 'u1', name: 'A', preview: '/a' });
    await expect(
      svc.update('someone-else', 'c-1', { name: 'Hacked' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(components.updateCalls).toHaveLength(0);
    expect(files.deleteCalls).toHaveLength(0);
  });
});
