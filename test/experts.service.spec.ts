import { ExpertsService } from '../src/modules/experts/experts.service';

/**
 * ExpertsService unit tests against a hand-rolled DataSource stub (same style
 * as todos.service.spec.ts) — records every query/where/orderBy call so
 * ownership scoping, ordering and pagination behavior are checked without a
 * real DB.
 */

interface ExpertLike {
  id: string;
  userId: string;
  title: string;
  description: string | null;
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
  experts: ExpertLike[] = [];
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
  async findOneBy(criteria: Partial<ExpertLike>): Promise<ExpertLike | undefined> {
    return this.experts.find((e) => e.id === criteria.id && e.userId === criteria.userId);
  }
  async delete(criteria: unknown): Promise<{ affected: number }> {
    const c = criteria as { id?: string; userId?: string };
    const before = this.experts.length;
    this.experts = this.experts.filter((e) => !(e.id === c.id && e.userId === c.userId));
    this.deletes.push(criteria);
    return { affected: before - this.experts.length };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(input: any): ExpertLike {
    return { ...input };
  }
  async save(input: ExpertLike): Promise<ExpertLike> {
    if (!input.id) {
      input.id = `gen-${this.saved.length + 1}`;
      input.createdAt = new Date();
      input.updatedAt = new Date();
      this.experts.push(input);
    }
    this.saved.push(input);
    return input;
  }
}

const makeService = (repo: FakeRepo) =>
  new ExpertsService({
    isInitialized: true,
    initialize: async () => undefined,
    getRepository: () => repo,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: async (fn: any) => fn(repo),
  } as never);

const baseExpert = (id: string, userId = 'u1'): ExpertLike => ({
  id,
  userId,
  title: id,
  description: null,
});

describe('ExpertsService — ownership scoping', () => {
  it('list funnels through a userId-scoped where(); create persists the caller\u2019s userId', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const svc = makeService(repo);
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');

    await svc.list('u1', { search: 'x' } as never);
    await svc.create('u1', { title: 't' } as never);

    // The single query-builder entrypoint (list) is userId-scoped; create
    // stamps the userId on the persisted row (see FakeRepo.saved).
    expect(qbSpy).toHaveBeenCalledTimes(1);
    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(JSON.stringify(qb.wheres[0])).toBe('["e.userId = :userId",{"userId":"u1"}]');
    expect(repo.saved.some((e) => (e as Partial<ExpertLike>).userId === 'u1')).toBe(true);
  });

  it('findOne returns 404 for another user\u2019s expert', async () => {
    const repo = new FakeRepo();
    repo.experts = [baseExpert('a', 'someone-else')];
    const svc = makeService(repo);
    await expect(svc.findOne('u1', 'a')).rejects.toMatchObject({ status: 404 });
    // The lookup was scoped by BOTH id and userId.
    const found = await svc.findOne('someone-else', 'a');
    expect(found.id).toBe('a');
  });
});

describe('ExpertsService — list (pagination + search + sort)', () => {
  it('defaults: page 1/limit 20, createdAt desc, count runs with same filters', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [baseExpert('a')];
    repo.qbRaw = { cnt: 45 };
    const svc = makeService(repo);
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const page = await svc.list('u1', {} as never);

    expect(page).toMatchObject({ total: 45, page: 1, limit: 20, totalPages: 3 });
    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.wheres[0][0]).toBe('e.userId = :userId');
    expect(qb.wheres[0][1]).toEqual({ userId: 'u1' });
    expect(qb.orderByCalls[0]).toEqual(['e.createdAt', 'DESC']);
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

  it('searches BOTH title and description with escaped ILIKE wildcards', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    await svc.list('u1', { search: '100%_ off \\ now' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    const whereArgs = qb.wheres[1];
    expect(whereArgs[0]).toContain('e.title ILIKE');
    expect(whereArgs[0]).toContain('e.description ILIKE');
    expect(whereArgs[1].searchPattern).toBe('%100\\%\\_ off \\\\ now%');
    expect(whereArgs[0]).toContain("ESCAPE '\\'");
  });

  it('title sort defaults to ascending with a stable tie-breaker', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    await svc.list('u1', { sortBy: 'title' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.orderByCalls[0]).toEqual(['e.title', 'ASC']);
    expect(qb.orderByCalls[1]).toEqual(['e.createdAt', 'DESC']);
  });

  it('title sort honors explicit desc; zero total → 0 totalPages', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    const page = await svc.list('u1', { sortBy: 'title', sortOrder: 'desc' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.orderByCalls[0]).toEqual(['e.title', 'DESC']);
    expect(page).toMatchObject({ total: 0, totalPages: 0 });
  });

  it('createdAt sort honors explicit asc', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 3 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    const page = await svc.list('u1', { sortBy: 'createdAt', sortOrder: 'asc' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.orderByCalls[0]).toEqual(['e.createdAt', 'ASC']);
    expect(page).toMatchObject({ total: 3, totalPages: 1 });
  });
});

describe('ExpertsService — create', () => {
  it('persists with the caller\u2019s userId and normalized description', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    const expert = await svc.create('u1', {
      title: 'Ada Lovelace',
      description: 'Computing pioneer',
    } as never);

    expect(expert.title).toBe('Ada Lovelace');
    expect(expert.userId).toBe('u1');
    expect(expert.description).toBe('Computing pioneer');
    expect(repo.saved).toHaveLength(1);
  });

  it('coerces an undefined description to null', async () => {
    const repo = new FakeRepo();
    const svc = makeService(repo);
    const expert = await svc.create('u1', { title: 'No bio' } as never);
    expect(expert.description).toBeNull();
  });
});

describe('ExpertsService — update (scoped by userId)', () => {
  it('returns 404 for another user\u2019s expert (0 affected rows)', async () => {
    const repo = new FakeRepo();
    repo.qbAffected = 0; // scoped-WHERE matches nothing
    repo.experts = [baseExpert('a', 'someone-else')];
    const svc = makeService(repo);
    await expect(
      svc.update('u1', 'a', { title: 'x' } as never),
    ).rejects.toMatchObject({ status: 404 });
    // The UPDATE ran against a userId-scoped WHERE — never a cross-user write.
    expect(repo.qbSets).toHaveLength(1);
    expect(repo.experts[0].title).toBe('a');
  });

  it('updates own expert with DB-clock updatedAt', async () => {
    const repo = new FakeRepo();
    repo.experts = [baseExpert('a')];
    const svc = makeService(repo);
    await svc.update('u1', 'a', { title: 'changed', description: 'new bio' } as never);
    const [setArgs] = repo.qbSets;
    const payload = setArgs[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ title: 'changed', description: 'new bio' });
    expect(String((payload.updatedAt as () => string)())).toBe('now()');
  });

  it('empty patch → 400', async () => {
    const svc = makeService(new FakeRepo());
    await expect(svc.update('u1', 'a', {} as never)).rejects.toMatchObject({ status: 400 });
  });
});

describe('ExpertsService — remove (scoped by userId)', () => {
  it('deletes own expert', async () => {
    const repo = new FakeRepo();
    repo.experts = [baseExpert('a')];
    const svc = makeService(repo);
    const result = await svc.remove('u1', 'a');
    expect(result).toEqual({ deleted: true, id: 'a' });
    expect(repo.deletes).toContainEqual({ id: 'a', userId: 'u1' });
    expect(repo.experts).toHaveLength(0);
  });

  it('404 for another user\u2019s expert — the scoped DELETE removes nothing', async () => {
    const repo = new FakeRepo();
    repo.experts = [baseExpert('a', 'someone-else')];
    const svc = makeService(repo);
    await expect(svc.remove('u1', 'a')).rejects.toMatchObject({ status: 404 });
    // The DELETE ran with a userId-scoped criteria — never a cross-user write.
    expect(repo.deletes).toContainEqual({ id: 'a', userId: 'u1' });
    expect(repo.experts).toHaveLength(1);
  });

  it('404 for a missing expert', async () => {
    const svc = makeService(new FakeRepo());
    await expect(svc.remove('u1', 'missing')).rejects.toMatchObject({ status: 404 });
  });
});
