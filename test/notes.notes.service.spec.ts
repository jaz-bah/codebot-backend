import { NotesService } from '../src/modules/notes/notes.service';
import { Note } from '../src/database/typeorm/entities/note.entity';
import { WorkspaceFile } from '../src/database/typeorm/entities/workspace-file.entity';

/**
 * NotesService unit tests against hand-rolled DataSource/repo stubs (same
 * style as todos.service.spec.ts): pagination envelope, escaped-LIKE search
 * across content + file name, folder filter, ownership 404/400 semantics and
 * the transactional content upsert — no real DB.
 */

class FakeQb {
  wheres: unknown[][] = [];
  orderByCalls: unknown[][] = [];
  selectCalls: unknown[][] = [];
  skipValue?: number;
  takeValue?: number;

  constructor(private readonly repo: FakeRepo) {}

  where(...args: unknown[]): FakeQb {
    this.wheres.push(args);
    this.repo.qbWheres.push(args);
    return this;
  }
  andWhere(...args: unknown[]): FakeQb {
    this.wheres.push(args);
    this.repo.qbWheres.push(args);
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
  async getRawMany<T>(): Promise<T[]> {
    return (this.repo.rawMany ?? []) as T[];
  }
  async getRawOne<T>(): Promise<T | undefined> {
    return (this.repo.rawOne ?? undefined) as T | undefined;
  }
  async getOne(): Promise<unknown> {
    return this.repo.getOneResult;
  }
  clone(): FakeQb {
    const c = new FakeQb(this.repo);
    this.repo.clones.push(c); // clones bypass createQueryBuilder — track them
    return c;
  }
  update(): FakeQb {
    return this;
  }
  set(...args: unknown[]): FakeQb {
    this.setArgs = args;
    this.repo.setArgs = args; // expose the last UPDATE payload to tests
    return this;
  }
  async execute(): Promise<{ affected: number | undefined }> {
    this.repo.updatesExecuted += 1;
    return { affected: 1 };
  }
  setArgs?: unknown[];
}

class FakeRepo {
  rawMany?: unknown[];
  rawOne?: unknown;
  getOneResult?: unknown;
  updatesExecuted = 0;
  setArgs?: unknown[];
  updates: { criteria: unknown; payload: unknown }[] = [];
  saves: unknown[] = [];
  clones: FakeQb[] = [];
  qbWheres: unknown[][] = [];

  createQueryBuilder(): FakeQb {
    return new FakeQb(this);
  }
  async findOneBy(): Promise<undefined> {
    return undefined;
  }
  update(criteria: unknown, payload: unknown): void {
    this.updates.push({ criteria, payload });
  }
  create(input: unknown): unknown {
    return input;
  }
  async save(input: unknown): Promise<unknown> {
    this.saves.push(input);
    return input;
  }
}

const RAW_NOTE = {
  id: 'note-1',
  fileId: 'file-1',
  fileName: 'meeting-notes.html',
  folderId: 'folder-1',
  content: '<h2>Team sync</h2><p>metrics</p>',
  createdAt: new Date('2026-10-19T00:00:00.000Z'),
  updatedAt: new Date('2026-10-19T01:00:00.000Z'),
};

const makeService = (fileRepo: FakeRepo, noteRepo: FakeRepo) =>
  new NotesService({
    isInitialized: true,
    initialize: async () => undefined,
    getRepository: (entity: unknown) => (entity === Note ? noteRepo : fileRepo),
    transaction: async (fn: (em: unknown) => unknown) =>
      fn({
        getRepository: (entity: unknown) => (entity === Note ? noteRepo : fileRepo),
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

describe('NotesService — list (pagination + search + filter + sort)', () => {
  it('default envelope: page 1 / limit 20 / updatedAt desc, preview stripped of tags', async () => {
    const fileRepo = new FakeRepo();
    const noteRepo = new FakeRepo();
    noteRepo.rawMany = [{ ...RAW_NOTE }];
    noteRepo.rawOne = { cnt: 42 };
    const svc = makeService(fileRepo, noteRepo);
    const qbSpy = jest.spyOn(noteRepo, 'createQueryBuilder');

    const page = await svc.list('u1', {} as never);

    expect(page).toMatchObject({
      total: 42,
      page: 1,
      limit: 20,
      totalPages: 3,
    });
    expect(page.items[0]).toMatchObject({
      id: 'note-1',
      fileId: 'file-1',
      fileName: 'meeting-notes.html',
      folderId: 'folder-1',
    });
    expect(page.items[0].preview).not.toContain('<h2>');

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.wheres[0][0]).toBe('n.userId = :userId');
    expect(qb.wheres[0][1]).toEqual({ userId: 'u1' });
    expect(qb.orderByCalls[0]).toEqual(['n.updated_at', 'DESC']);
    expect(qb.skipValue).toBe(0);
    expect(qb.takeValue).toBe(20);
    const selects = qb.selectCalls.flat().join(' ');
    expect(selects).toContain('regexp_replace'); // tag strip for preview
    // The count ran as a clone (same filters) with a COUNT select.
    const allQbs = [
      ...qbSpy.mock.results.map((r) => r.value as FakeQb),
      ...noteRepo.clones,
    ];
    expect(allQbs.some((q) => q.selectCalls.flat().join(' ').includes('COUNT'))).toBe(true);
  });

  it('search matches content AND file name with escaped LIKE wildcards', async () => {
    const fileRepo = new FakeRepo();
    const noteRepo = new FakeRepo();
    noteRepo.rawMany = [];
    noteRepo.rawOne = { cnt: 0 };
    const svc = makeService(fileRepo, noteRepo);
    const qbSpy = jest.spyOn(noteRepo, 'createQueryBuilder');

    await svc.list('u1', { search: '100%_ \\ x' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    const where = qb.wheres.find((w) => String(w[0]).includes('ILIKE'));
    expect(String(where?.[0])).toContain('n.content ILIKE');
    expect(String(where?.[0])).toContain('f.name ILIKE');
    expect(where?.[1]).toMatchObject({ searchPattern: '%100\\%\\_ \\\\ x%' });
  });

  it('filters by folderId and maps fileName sort to the joined column', async () => {
    const fileRepo = new FakeRepo();
    const noteRepo = new FakeRepo();
    noteRepo.rawMany = [];
    noteRepo.rawOne = { cnt: 0 };
    const svc = makeService(fileRepo, noteRepo);
    const qbSpy = jest.spyOn(noteRepo, 'createQueryBuilder');

    await svc.list('u1', {
      folderId: '00000000-0000-4000-8000-000000000009',
      sortBy: 'fileName',
      sortOrder: 'asc',
    } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.wheres.some((w) => w[0] === 'f.parent_id = :folderId')).toBe(true);
    expect(qb.orderByCalls[0]).toEqual(['f.name', 'ASC']);
  });
});

describe('NotesService — getByFile (read content)', () => {
  it('returns the joined detail for the owning user', async () => {
    const fileRepo = new FakeRepo();
    const noteRepo = new FakeRepo();
    noteRepo.rawOne = { ...RAW_NOTE };
    const svc = makeService(fileRepo, noteRepo);

    const detail = await svc.getByFile('u1', 'file-1');
    expect(detail).toMatchObject({ id: 'note-1', content: RAW_NOTE.content, fileName: 'meeting-notes.html' });
    expect(detail.createdAt).toContain('2026-10-19');
  });

  it('404 for a note the user does not own', async () => {
    const fileRepo = new FakeRepo(); // folder lookup also misses → stays 404
    const noteRepo = new FakeRepo();
    noteRepo.rawOne = undefined;
    const svc = makeService(fileRepo, noteRepo);
    await expect(svc.getByFile('u1', 'file-1')).rejects.toMatchObject({ status: 404 });
  });

  it('400 when the id belongs to a folder (folders have no content)', async () => {
    const fileRepo = new FakeRepo();
    const noteRepo = new FakeRepo();
    noteRepo.rawOne = undefined;
    fileRepo.getOneResult = undefined;
    jest
      .spyOn(fileRepo, 'findOneBy')
      .mockResolvedValue({
        id: 'folder-1',
        userId: 'u1',
        name: 'General',
        type: 'folder',
        parentId: null,
        position: 0,
      } as never);
    const svc = makeService(fileRepo, noteRepo);
    await expect(svc.getByFile('u1', 'folder-1')).rejects.toMatchObject({ status: 400 });
  });
});

describe('NotesService — update (transactional upsert)', () => {
  const detailRow = (): unknown => ({ ...RAW_NOTE });

  it('updates content on the existing note with DB-clock updatedAt', async () => {
    const fileRepo = new FakeRepo();
    const noteRepo = new FakeRepo();
    jest
      .spyOn(fileRepo, 'findOneBy')
      .mockResolvedValue({
        id: 'file-1',
        userId: 'u1',
        name: 'meeting-notes.html',
        type: 'file',
        parentId: null,
        position: 0,
      } as never);
    jest.spyOn(noteRepo, 'findOneBy').mockResolvedValue({ id: 'note-1' } as never);
    noteRepo.rawOne = detailRow();
    const svc = makeService(fileRepo, noteRepo);

    const detail = await svc.update('u1', 'file-1', { content: '<p>new</p>' });
    expect(detail.content).toBe(RAW_NOTE.content); // re-read via getByFile
    expect(noteRepo.updatesExecuted).toBe(1);
    expect(noteRepo.saves).toHaveLength(0);
    const setter = (noteRepo.setArgs as unknown as Record<string, unknown>[])[0];
    expect(setter).toMatchObject({ content: '<p>new</p>' });
    expect(String((setter.updatedAt as () => string)())).toBe('now()');
    const update = noteRepo.qbWheres.find((w) => String(w[0]).includes('user_id'));
    expect(update?.[1]).toMatchObject({ id: 'note-1', userId: 'u1' });
  });

  it('inserts when no note row exists yet (defensive upsert)', async () => {
    const fileRepo = new FakeRepo();
    const noteRepo = new FakeRepo();
    jest
      .spyOn(fileRepo, 'findOneBy')
      .mockResolvedValue({ id: 'file-1', userId: 'u1', type: 'file' } as never);
    jest.spyOn(noteRepo, 'findOneBy').mockResolvedValue(undefined);
    noteRepo.rawOne = detailRow();
    const svc = makeService(fileRepo, noteRepo);

    await svc.update('u1', 'file-1', { content: '' });
    expect(noteRepo.updatesExecuted).toBe(0);
    expect(noteRepo.saves).toEqual([{ fileId: 'file-1', userId: 'u1', content: '' }]);
  });

  it('404 for another user’s file — nothing written', async () => {
    const fileRepo = new FakeRepo();
    const noteRepo = new FakeRepo();
    const svc = makeService(fileRepo, noteRepo);
    await expect(
      svc.update('u1', 'stranger', { content: '<p>x</p>' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(noteRepo.updatesExecuted).toBe(0);
    expect(noteRepo.saves).toHaveLength(0);
  });

  it('400 when the target is a folder', async () => {
    const fileRepo = new FakeRepo();
    const noteRepo = new FakeRepo();
    jest
      .spyOn(fileRepo, 'findOneBy')
      .mockResolvedValue({ id: 'folder-1', userId: 'u1', type: 'folder' } as never);
    const svc = makeService(fileRepo, noteRepo);
    await expect(
      svc.update('u1', 'folder-1', { content: '<p>x</p>' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
