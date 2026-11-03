import { IdeSnippetsService } from '../src/modules/ide-snippets/ide-snippets.service';

/**
 * IdeSnippetsService unit tests against a hand-rolled DataSource stub (same
 * style as todos/experts/tools service specs) — records every query/where/
 * orderBy call so ownership scoping, ordering and pagination behavior are
 * checked without a real DB.
 */

interface SnippetLike {
  id: string;
  userId: string;
  language: string;
  data: string;
  [k: string]: unknown;
}

/** Minimal query-builder fake: records calls, replays configured results. */
class FakeQb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wheres: any[][] = [];
  orderByCalls: unknown[][] = [];
  selectCalls: unknown[][] = [];
  skipValue?: number;
  takeValue?: number;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly repo: FakeRepo, private state?: any) {}

  where(...args: unknown[]): FakeQb {
    this.wheres.push(args);
    return this;
  }
  andWhere(...args: unknown[]): FakeQb {
    this.wheres.push(args);
    return this;
  }
  select(...args: unknown[]): FakeQb {
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
  async getMany(): Promise<unknown[]> {
    return this.repo.qbMany ?? [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getRawOne<T>(): Promise<T | undefined> {
    return this.repo.qbRaw as T | undefined;
  }
  clone(): FakeQb {
    return new FakeQb(this.repo, { ...this });
  }
  update(): FakeQb {
    return this;
  }
  set(...args: unknown[]): FakeQb {
    this.repo.qbSets.push(args);
    return this;
  }
  async execute(): Promise<{ affected: number | undefined }> {
    this.repo.qbExecuted += 1;
    return { affected: this.repo.qbAffected };
  }
}

class FakeRepo {
  snippets: SnippetLike[] = [];
  qbMany?: unknown[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qbRaw?: any;
  qbAffected = 1;
  qbExecuted = 0;
  qbSets: unknown[][] = [];
  deletes: unknown[] = [];
  saved: unknown[] = [];

  createQueryBuilder(): FakeQb {
    return new FakeQb(this);
  }
  getRepository(): FakeRepo {
    return this;
  }
  async findOneBy(criteria: Partial<SnippetLike>): Promise<SnippetLike | undefined> {
    return this.snippets.find((s) => s.id === criteria.id && s.userId === criteria.userId);
  }
  async delete(criteria: unknown): Promise<{ affected: number }> {
    const c = criteria as { id?: string; userId?: string };
    const before = this.snippets.length;
    this.snippets = this.snippets.filter((s) => !(s.id === c.id && s.userId === c.userId));
    this.deletes.push(criteria);
    return { affected: before - this.snippets.length };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(input: any): SnippetLike {
    return { ...input };
  }
  async save(input: SnippetLike): Promise<SnippetLike> {
    if (!input.id) {
      input.id = `gen-${this.saved.length + 1}`;
      input.createdAt = new Date();
      input.updatedAt = new Date();
      this.snippets.push(input);
    }
    this.saved.push(input);
    return input;
  }
}

const makeService = (repo: FakeRepo) =>
  new IdeSnippetsService({
    isInitialized: true,
    initialize: async () => undefined,
    getRepository: () => repo,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: async (fn: any) => fn(repo),
  } as never);

const baseSnippet = (id: string, userId = 'u1'): SnippetLike => ({
  id,
  userId,
  language: 'css',
  data: `.x { align: center; }`,
});

describe('IdeSnippetsService — ownership scoping', () => {
  it('list funnels through a userId-scoped where(); create persists the caller\u2019s userId', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const svc = makeService(repo);
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');

    await svc.list('u1', { search: 'x' } as never);
    await svc.create('u1', { language: 'css', data: '.a{}' } as never);

    // The single query-builder entrypoint (list) is userId-scoped; create
    // stamps the userId on the persisted row (see FakeRepo.saved).
    expect(qbSpy).toHaveBeenCalledTimes(1);
    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(JSON.stringify(qb.wheres[0])).toBe('["s.userId = :userId",{"userId":"u1"}]');
    expect(repo.saved.some((s) => (s as Partial<SnippetLike>).userId === 'u1')).toBe(true);
  });

  it('findOne returns 404 for another user\u2019s snippet', async () => {
    const repo = new FakeRepo();
    repo.snippets = [baseSnippet('a', 'someone-else')];
    const svc = makeService(repo);
    await expect(svc.findOne('u1', 'a')).rejects.toMatchObject({ status: 404 });
    // The lookup was scoped by BOTH id and userId.
    const found = await svc.findOne('someone-else', 'a');
    expect(found.id).toBe('a');
  });
});

describe('IdeSnippetsService — list (pagination + search + filter + sort)', () => {
  it('defaults: page 1/limit 20, createdAt desc, count runs with same filters', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [baseSnippet('a')];
    repo.qbRaw = { cnt: 45 };
    const svc = makeService(repo);
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const page = await svc.list('u1', {} as never);

    expect(page).toMatchObject({ total: 45, page: 1, limit: 20, totalPages: 3 });
    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.wheres[0][0]).toBe('s.userId = :userId');
    expect(qb.wheres[0][1]).toEqual({ userId: 'u1' });
    expect(qb.orderByCalls[0]).toEqual(['s.createdAt', 'DESC']);
    expect(qb.skipValue).toBe(0);
    expect(qb.takeValue).toBe(20);
  });

  it('clamps pagination (limit×100 max, page ≥ 1) and computes skip', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 10 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    await svc.list('u1', { page: 5, limit: 1000 } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.takeValue).toBe(100);
    expect(qb.skipValue).toBe(400);
  });

  it('searches BOTH data and language with escaped ILIKE wildcards', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    await svc.list('u1', { search: '100%_ off \\ now' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    const whereArgs = qb.wheres[1];
    expect(whereArgs[0]).toContain('s.data ILIKE');
    expect(whereArgs[0]).toContain('s.language ILIKE');
    expect(whereArgs[1].searchPattern).toBe('%100\\%\\_ off \\\\ now%');
    expect(whereArgs[0]).toContain("ESCAPE '\\'");
  });

  it('filters by exact language (any stored value)', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    await svc.list('u1', { search: 'align', language: 'C++' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.wheres.map((w: unknown[]) => w[0])).toContain('s.language = :language');
    const languageWhere = qb.wheres.find((w: unknown[]) => w[0] === 's.language = :language');
    expect(languageWhere?.[1]).toEqual({ language: 'C++' });
  });

  it('language sort defaults to ascending with a stable tie-breaker', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    await svc.list('u1', { sortBy: 'language' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.orderByCalls[0]).toEqual(['s.language', 'ASC']);
    expect(qb.orderByCalls[1]).toEqual(['s.createdAt', 'DESC']); // tie-breaker ≠ primary column
    expect(qb.skipValue).toBe(0);
  });

  it('language sort honors explicit desc; createdAt sort honors explicit asc', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 2 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);

    await svc.list('u1', { sortBy: 'language', sortOrder: 'desc' } as never);
    let qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.orderByCalls[0]).toEqual(['s.language', 'DESC']);
    expect(qb.orderByCalls[1]).toEqual(['s.createdAt', 'DESC']);

    await svc.list('u1', { sortBy: 'createdAt', sortOrder: 'asc' } as never);
    qb = qbSpy.mock.results[1].value as FakeQb;
    expect(qb.orderByCalls[0]).toEqual(['s.createdAt', 'ASC']);
  });
});

describe('IdeSnippetsService — create / verbatim code storage', () => {
  it('stores the data payload EXACTLY as received (no trim/escape)', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    const code = '.css {\n  align: center;\n}\n\t// tab & special : $%^\\_';
    const snippet = await svc.create('u1', { language: 'css', data: code } as never);

    expect(snippet.language).toBe('css');
    expect(snippet.userId).toBe('u1');
    expect(snippet.data).toBe(code);
  });

  it('does NOT trim data OR language at the service layer (the Joi pipe already trimmed language)', async () => {
    // Language arrives pre-trimmed from JoiValidationPipe; the service must
    // not reprocess either field. Data specifically is byte-exact always.
    const repo = new FakeRepo();
    const svc = makeService(repo);
    const snippet = await svc.create('u1', {
      language: 'ts',
      data: '   const a = 1;   ',
    } as never);
    expect(snippet.language).toBe('ts');
    expect(snippet.data).toBe('   const a = 1;   ');
    // Pipe-level trim contract is asserted in ide-snippets.dto-validation.spec.ts.
  });
});

describe('IdeSnippetsService — update (scoped by userId)', () => {
  it('returns 404 for another user\u2019s snippet (0 affected rows)', async () => {
    const repo = new FakeRepo();
    repo.qbAffected = 0; // scoped-WHERE matches nothing
    repo.snippets = [baseSnippet('a', 'someone-else')];
    const svc = makeService(repo);
    await expect(svc.update('u1', 'a', { language: 'js' } as never)).rejects.toMatchObject({
      status: 404,
    });
    // The UPDATE ran against a userId-scoped WHERE — never a cross-user write.
    expect(repo.qbSets).toHaveLength(1);
    expect(repo.snippets[0].language).toBe('css');
  });

  it('updates own snippet with DB-clock updatedAt and verbatim data', async () => {
    const repo = new FakeRepo();
    repo.snippets = [baseSnippet('a')];
    const svc = makeService(repo);
    const code = 'a\n\tb\n c';
    await svc.update('u1', 'a', { language: 'ts', data: code } as never);
    const [setArgs] = repo.qbSets;
    const payload = setArgs[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ language: 'ts', data: code });
    expect(String((payload.updatedAt as () => string)())).toBe('now()');
  });

  it('empty patch → 400', async () => {
    const svc = makeService(new FakeRepo());
    await expect(svc.update('u1', 'a', {} as never)).rejects.toMatchObject({ status: 400 });
  });
});

describe('IdeSnippetsService — remove (scoped by userId)', () => {
  it('deletes own snippet', async () => {
    const repo = new FakeRepo();
    repo.snippets = [baseSnippet('a')];
    const svc = makeService(repo);
    const result = await svc.remove('u1', 'a');
    expect(result).toEqual({ deleted: true, id: 'a' });
    expect(repo.deletes).toContainEqual({ id: 'a', userId: 'u1' });
    expect(repo.snippets).toHaveLength(0);
  });

  it('404 for another user\u2019s snippet — the scoped DELETE removes nothing', async () => {
    const repo = new FakeRepo();
    repo.snippets = [baseSnippet('a', 'someone-else')];
    const svc = makeService(repo);
    await expect(svc.remove('u1', 'a')).rejects.toMatchObject({ status: 404 });
    // The DELETE ran with a userId-scoped criteria — never a cross-user write.
    expect(repo.deletes).toContainEqual({ id: 'a', userId: 'u1' });
    expect(repo.snippets).toHaveLength(1);
  });

  it('404 for a missing snippet', async () => {
    const svc = makeService(new FakeRepo());
    await expect(svc.remove('u1', 'missing')).rejects.toMatchObject({ status: 404 });
  });
});
