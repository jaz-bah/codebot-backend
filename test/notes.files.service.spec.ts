import { FilesService } from '../src/modules/notes/files.service';
import { Note } from '../src/database/typeorm/entities/note.entity';
import { WorkspaceFile } from '../src/database/typeorm/entities/workspace-file.entity';
import type { CreateFileDto } from '../src/modules/notes/dto/create-file.dto';

/**
 * FilesService unit tests against a hand-rolled DataSource stub (same style as
 * todos.service.spec.ts) — ownership scoping, tree assembly, sibling-name
 * uniqueness, cycle-safe moves and transactional gap compaction, all verified
 * without a real DB.
 */

interface FileLike {
  id: string;
  userId: string;
  name: string;
  type: 'folder' | 'file';
  parentId: string | null;
  position: number;
  [k: string]: unknown;
}

class FakeQb {
  wheres: unknown[][] = [];
  orderByCalls: unknown[][] = [];
  selectCalls: unknown[][] = [];
  skipValue?: number;
  takeValue?: number;
  updateArgs: unknown[] = [];
  setArgs: unknown | undefined;
  limitRaw?: number;

  constructor(private readonly repo: FakeRepo) {}

  where(...args: unknown[]): FakeQb {
    this.wheres.push(args);
    return this;
  }
  andWhere(...args: unknown[]): FakeQb {
    this.wheres.push(args);
    return this;
  }
  select(...args: unknown[]): FakeQb {
    this.selectCalls = [args];
    return this;
  }
  addSelect(...args: unknown[]): FakeQb {
    this.selectCalls.push(args);
    return this;
  }
  orderBy(...args: unknown[]): FakeQb {
    this.orderByCalls.unshift(args);
    return this;
  }
  addOrderBy(...args: unknown[]): FakeQb {
    this.orderByCalls.push(args);
    return this;
  }
  skip(v: number): FakeQb {
    this.skipValue = v;
    return this;
  }
  take(v: number): FakeQb {
    this.takeValue = v;
    return this;
  }
  leftJoin(): FakeQb {
    return this;
  }
  async getMany(): Promise<unknown[]> {
    return this.repo.qbMany ?? this.repo.files;
  }
  async getOne(): Promise<FileLike | undefined> {
    // Sibling-name check: replay via repo.siblingClash or default none.
    return this.repo.siblingClash;
  }
  async getRawOne<T>(): Promise<T | undefined> {
    return this.repo.qbRaw as T | undefined;
  }
  clone(): FakeQb {
    return new FakeQb(this.repo);
  }
  update(): FakeQb {
    return this;
  }
  set(...args: unknown[]): FakeQb {
    this.setArgs = args;
    return this;
  }
  async execute(): Promise<{ affected: number | undefined }> {
    this.repo.compactExecuted += 1;
    return { affected: 1 };
  }
}

class FakeRepo {
  files: FileLike[] = [];
  notes: { fileId: string; userId: string; content: string }[] = [];
  qbMany?: unknown[];
  qbRaw?: unknown;
  siblingClash?: FileLike;
  compactExecuted = 0;
  updates: { criteria: unknown; payload: unknown }[] = [];
  deletes: unknown[] = [];
  saves: unknown[] = [];

  createQueryBuilder(): FakeQb {
    return new FakeQb(this);
  }
  getRepository(entity: unknown): FakeRepo {
    return this;
  }
  async findOneBy(criteria: Record<string, unknown>): Promise<FileLike | undefined> {
    return this.files.find(
      (f) => f.id === criteria.id && (criteria.userId === undefined || f.userId === criteria.userId),
    );
  }
  async find(): Promise<FileLike[]> {
    return this.files;
  }
  async update(criteria: unknown, payload: unknown): Promise<{ affected: number }> {
    const c = criteria as { id?: string; userId?: string };
    const matches = this.files.filter((f) => f.id === c.id && f.userId === c.userId);
    for (const f of matches) Object.assign(f, payload as Record<string, unknown>);
    this.updates.push({ criteria, payload });
    return { affected: matches.length };
  }
  async delete(criteria: unknown): Promise<{ affected: number }> {
    const c = criteria as { id?: string; userId?: string };
    const before = this.files.length;
    this.files = this.files.filter((f) => !(f.id === c.id && f.userId === c.userId));
    this.notes = this.notes.filter((n) => n.fileId !== c.id);
    this.deletes.push(criteria);
    return { affected: before - this.files.length };
  }
  create(input: Record<string, unknown>): Record<string, unknown> {
    return { ...input };
  }
  async save(input: Record<string, unknown> & { id?: string }): Promise<never> {
    throw new Error('use saveFn override');
  }
}

const makeService = (repo: FakeRepo) =>
  new FilesService({
    isInitialized: true,
    initialize: async () => undefined,
    getRepository: () => repo,
    transaction: async (fn: (em: unknown) => unknown) =>
      fn({
        getRepository: (entity: unknown) =>
          entity === Note ? new NoteRepoAdapter(repo) : repo,
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

/**
 * Note-repo adapter over the single FakeRepo (create/save tracked separately
 * so tests can assert note seeding).
 */
class NoteRepoAdapter {
  constructor(private readonly repo: FakeRepo) {}
  create(input: Record<string, unknown>): Record<string, unknown> {
    return { ...input };
  }
  async save(input: { fileId?: string; userId?: string; content?: string }): Promise<unknown> {
    this.repo.notes.push({
      fileId: input.fileId ?? '',
      userId: input.userId ?? '',
      content: input.content ?? '',
    });
    this.repo.saves.push(input);
    return input;
  }
  async findOneBy(): Promise<undefined> {
    return undefined;
  }
  createQueryBuilder(): FakeQb {
    return new FakeQb(this.repo);
  }
}

const folder = (id: string, opts: Partial<FileLike> = {}): FileLike => ({
  id,
  userId: 'u1',
  name: id,
  type: 'folder',
  parentId: null,
  position: 0,
  ...opts,
});

const withSave = (repo: FakeRepo): void => {
  // Give the file repo a save that assigns ids + appends rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (repo as any).save = async (input: Record<string, unknown>) => {
    const file = {
      ...(input as FileLike),
      id: (input.id as string) ?? `gen-${repo.files.length + 1}`,
    } as FileLike;
    repo.files.push(file);
    repo.saves.push(file);
    return file;
  };
};

describe('FilesService — ownership scoping', () => {
  it('every entrypoint funnels through a userId-scoped where()', async () => {
    const repo = new FakeRepo();
    withSave(repo);
    repo.qbRaw = { maxPos: -1 };
    const svc = makeService(repo);
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');

    await svc.tree('u1');
    await svc.create('u1', { name: 'A', type: 'folder', parentId: null, content: null });

    for (const result of qbSpy.mock.results) {
      const qb = result.value as FakeQb;
      expect(qb.wheres.some((w) => JSON.stringify(w).includes('"u1"'))).toBe(true);
    }
  });
});

describe('FilesService — tree', () => {
  it('builds the nested structure in one query, order-preserving', async () => {
    const repo = new FakeRepo();
    repo.files = [
      folder('general', { name: 'General', position: 0 }),
      folder('ideas', { name: 'Ideas', position: 1 }),
      folder('welcome', { name: 'welcome.html', type: 'file', parentId: 'general', position: 0 }),
      folder('meeting', { name: 'meeting-notes.html', type: 'file', parentId: 'general', position: 1 }),
      folder('product', { name: 'product-ideas.html', type: 'file', parentId: 'ideas', position: 0 }),
    ];
    const svc = makeService(repo);
    const tree = await svc.tree('u1');

    expect(tree.map((n) => n.id)).toEqual(['general', 'ideas']);
    expect(tree[0].children.map((c) => c.name)).toEqual([
      'welcome.html',
      'meeting-notes.html',
    ]);
    expect(tree[0].children[0].type).toBe('file');
  });
});

describe('FilesService — list (folder contents)', () => {
  it('defaults: root listing (parentId IS NULL), position asc, clamped pagination', async () => {
    const repo = new FakeRepo();
    repo.qbRaw = { cnt: 3 };
    const svc = makeService(repo);
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');

    const page = await svc.list('u1', { page: 0, limit: 1000 } as never);

    expect(page).toMatchObject({ total: 3, page: 1, limit: 100, totalPages: 1 });
    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.wheres[0][0]).toBe('f.userId = :userId');
    expect(qb.wheres.some((w) => w[0] === 'f.parentId IS NULL')).toBe(true);
    expect(qb.orderByCalls[0]).toEqual(['f.position', 'ASC']);
    expect(qb.takeValue).toBe(100);
    expect(qb.skipValue).toBe(0);
  });

  it('filters by parentId, type, and name search with escaped wildcards', async () => {
    const repo = new FakeRepo();
    repo.qbRaw = { cnt: 0 };
    const svc = makeService(repo);
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');

    await svc.list('u1', {
      parentId: '00000000-0000-4000-8000-000000000001',
      type: 'file',
      search: '100%_ x \\ y',
    } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.wheres.some((w) => w[0] === 'f.parentId = :parentId')).toBe(true);
    expect(qb.wheres.some((w) => w[0] === 'f.type = :type')).toBe(true);
    const like = qb.wheres.find((w) => String(w[0]).includes('ILIKE'));
    expect(like?.[1]).toMatchObject({ searchPattern: '%100\\%\\_ x \\\\ y%' });
  });

  it('name sort defaults to asc, updatedAt to desc', async () => {
    const repo = new FakeRepo();
    repo.qbRaw = { cnt: 0 };
    const svc = makeService(repo);
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    await svc.list('u1', { sortBy: 'name' } as never);
    await svc.list('u1', { sortBy: 'updatedAt' } as never);
    const calls = qbSpy.mock.results;
    expect((calls[0].value as FakeQb).orderByCalls[0]).toEqual(['f.name', 'ASC']);
    expect((calls[1].value as FakeQb).orderByCalls[0]).toEqual(['f.updatedAt', 'DESC']);
  });
});

describe('FilesService — create (transactional)', () => {
  const dto = (extra: Record<string, unknown> = {}): CreateFileDto =>
    ({
      name: 'welcome.html',
      type: 'file',
      parentId: null,
      content: null,
      ...extra,
    }) as unknown as CreateFileDto;

  it('appends at MAX(position)+1 and seeds the note row for files', async () => {
    const repo = new FakeRepo();
    withSave(repo);
    repo.files = [
      folder('general', { name: 'General' }),
      folder('a', { name: 'welcome.html', type: 'file', parentId: 'general', position: 0 }),
    ];
    repo.qbRaw = { maxPos: '0' };
    const svc = makeService(repo);

    const file = await svc.create('u1', dto({ parentId: 'general', content: '<h2>hi</h2>' }));

    expect(file.position).toBe(1);
    expect(repo.saves).toHaveLength(2); // file row + note row
    expect(repo.notes[0]).toMatchObject({ content: '<h2>hi</h2>', userId: 'u1' });
  });

  it('404 unknown parent, 400 parent is a file', async () => {
    const repo = new FakeRepo();
    withSave(repo);
    repo.files = [folder('f1', { type: 'file' })];
    repo.qbRaw = { maxPos: -1 };
    const svc = makeService(repo);

    await expect(
      svc.create('u1', dto({ parentId: 'missing' })),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      svc.create('u1', dto({ parentId: 'f1' })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('409 on duplicate sibling name (case-insensitive)', async () => {
    const repo = new FakeRepo();
    withSave(repo);
    repo.files = [folder('welcome', { name: 'Welcome.HTML', type: 'file' })];
    repo.siblingClash = repo.files[0];
    repo.qbRaw = { maxPos: -1 };
    const svc = makeService(repo);

    await expect(svc.create('u1', dto({ name: 'welcome.html' }))).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('FilesService — update (rename/move)' , () => {
  it('empty patch → 400', async () => {
    const svc = makeService(new FakeRepo());
    await expect(svc.update('u1', 'a', {} as never)).rejects.toMatchObject({ status: 400 });
  });

  it('rename appends updatedAt=now() and keeps position', async () => {
    const repo = new FakeRepo();
    withSave(repo);
    repo.files = [folder('a', { name: 'old.html', type: 'file', parentId: null })];
    repo.qbRaw = { maxPos: '0' };
    const svc = makeService(repo);

    const updated = await svc.update('u1', 'a', { name: 'new-name.html' });
    expect(updated.name).toBe('new-name.html');
    expect(repo.compactExecuted).toBe(0);
    const lastUpdate = repo.updates[repo.updates.length - 1] as { payload: Record<string, unknown> };
    expect(lastUpdate.payload).toMatchObject({ name: 'new-name.html', position: 0 });
    expect(String((lastUpdate.payload.updatedAt as () => string)())).toBe('now()');
  });

  it('file rename without .html → 400', async () => {
    const repo = new FakeRepo();
    repo.files = [folder('a', { name: 'old.html', type: 'file' })];
    const svc = makeService(repo);
    await expect(svc.update('u1', 'a', { name: 'noext' })).rejects.toMatchObject({ status: 400 });
  });

  it('move into a non-folder parent → 400; unknown parent → 404', async () => {
    const repo = new FakeRepo();
    withSave(repo);
    repo.files = [
      folder('file1', { name: 'a.html', type: 'file' }),
      folder('file2', { name: 'b.html', type: 'file', parentId: null }),
    ];
    repo.qbRaw = { maxPos: '0' };
    const svc = makeService(repo);

    await expect(
      svc.update('u1', 'file1', { parentId: 'file2' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.update('u1', 'file1', { parentId: 'missing' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('moving a folder into itself or its own subtree → 400 (no cycle)', async () => {
    const repo = new FakeRepo();
    withSave(repo);
    repo.files = [
      folder('gen', { name: 'General' }),
      folder('sub', { name: 'Sub', parentId: 'gen' }),
    ];
    repo.qbRaw = { maxPos: '0' };
    const svc = makeService(repo);

    await expect(svc.update('u1', 'gen', { parentId: 'gen' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(svc.update('u1', 'gen', { parentId: 'sub' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('moving between folders: append at destination end + compact source gap', async () => {
    const repo = new FakeRepo();
    withSave(repo);
    repo.files = [
      folder('dst', { name: 'Dst', position: 5 }),
      folder('f1', { name: 'a.html', type: 'file', position: 3 }),
    ];
    repo.qbRaw = { maxPos: '2' }; // destination already has 3 siblings
    const svc = makeService(repo);

    const moved = await svc.update('u1', 'f1', { parentId: 'dst' });

    expect(repo.compactExecuted).toBe(1); // source gap closed
    expect(moved.position).toBe(3); // appended after destination siblings
  });
});

describe('FilesService — remove (cascade + compaction)', () => {
  it('deletes own row and shifts later sibling positions down', async () => {
    const repo = new FakeRepo();
    withSave(repo);
    repo.files = [
      folder('a', { parentId: 'gen', position: 0 }),
      folder('b', { parentId: 'gen', position: 1 }),
      folder('c', { parentId: 'gen', position: 2 }),
    ];
    const svc = makeService(repo);

    const result = await svc.remove('u1', 'b');
    expect(result).toEqual({ deleted: true, id: 'b' });
    expect(repo.deletes).toContainEqual({ id: 'b', userId: 'u1' });
    expect(repo.compactExecuted).toBe(1);
  });

  it('404 for another user’s row — nothing deleted', async () => {
    const repo = new FakeRepo();
    repo.files = [folder('a', { userId: 'someone-else' })];
    const svc = makeService(repo);
    await expect(svc.remove('u1', 'a')).rejects.toMatchObject({ status: 404 });
    expect(repo.deletes).toHaveLength(0);
    expect(repo.compactExecuted).toBe(0);
  });
});
