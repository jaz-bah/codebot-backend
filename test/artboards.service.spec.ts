import { ArtboardsService } from '../src/modules/artboards/artboards.service';
import type { QueryArtboardsDto } from '../src/modules/artboards/dto/query-artboards.dto';

/**
 * ArtboardsService unit tests against a hand-rolled DataSource stub (same style
 * as todos.service.spec.ts) — records every query/where/orderBy call so
 * ownership scoping, search escaping, ordering and pagination are checked
 * without a real DB.
 */

interface ArtboardLike {
  id: string;
  userId: string;
  title: string;
  content: string;
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
    return new FakeQb(this.repo);
  }
  update(): FakeQb {
    return this;
  }
  set(...args: unknown[]): FakeQb {
    this.repo.qbSets.push(args);
    return this;
  }
  async execute(): Promise<{ affected: number | undefined }> {
    return { affected: this.repo.qbAffected };
  }
}

class FakeRepo {
  artboards: ArtboardLike[] = [];
  qbMany?: unknown[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qbRaw?: any;
  qbAffected = 1;
  qbSets: unknown[][] = [];
  deletes: unknown[] = [];
  saved: unknown[] = [];

  createQueryBuilder(): FakeQb {
    return new FakeQb(this);
  }
  getRepository(): FakeRepo {
    return this;
  }
  async findOneBy(criteria: Partial<ArtboardLike>): Promise<ArtboardLike | undefined> {
    return this.artboards.find((a) => a.id === criteria.id && a.userId === criteria.userId);
  }
  async save(payload: unknown): Promise<ArtboardLike> {
    this.saved.push(payload);
    const row = payload as ArtboardLike;
    const stored: ArtboardLike = {
      ...row,
      id: row.id ?? `saved-${this.saved.length}`,
    };
    this.artboards.push(stored);
    return stored;
  }
  async delete(criteria: unknown): Promise<{ affected: number }> {
    const c = criteria as { id?: string; userId?: string };
    const before = this.artboards.length;
    this.artboards = this.artboards.filter((a) => !(a.id === c.id && a.userId === c.userId));
    this.deletes.push(criteria);
    return { affected: before - this.artboards.length };
  }
}

class FakeDataSource {
  isInitialized = true;
  repo = new FakeRepo();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRepository(): FakeRepo {
    return this.repo;
  }
}

const makeService = () => {
  const ds = new FakeDataSource();
  return { ds, service: new ArtboardsService(ds as never) };
};

const USER = 'user-1';
const OTHER = 'user-2';

describe('ArtboardsService — create', () => {
  it('stores content verbatim (no trim/normalization)', async () => {
    const { service, ds } = makeService();
    const raw = '  {"a": 1}\n\n<div>x</div>\t✓\n';
    const saved = await service.create(USER, { title: 'My Design', content: raw });
    expect(saved.content).toBe(raw);
    expect(ds.repo.saved[0]).toMatchObject({ userId: USER, title: 'My Design', content: raw });
  });

  it('defaults missing content to empty string', async () => {
    const { service, ds } = makeService();
    await service.create(USER, { title: 't', content: undefined as unknown as string });
    expect(ds.repo.saved[0]).toMatchObject({ content: '' });
  });
});

describe('ArtboardsService — list', () => {
  it('scopes every query by userId', async () => {
    const { service } = makeService();
    const calls: unknown[][] = [];
    const ds = new FakeDataSource();
    const origQb = ds.repo.createQueryBuilder.bind(ds.repo);
    ds.repo.createQueryBuilder = () => {
      const qb = origQb();
      const origWhere = qb.where.bind(qb);
      qb.where = (...args: unknown[]) => {
        calls.push(args);
        return origWhere(...(args as [string]));
      };
      return qb;
    };
    const svc = new ArtboardsService(ds as never);

    await svc.list(USER, {} as QueryArtboardsDto);
    expect(calls[0]?.[0]).toBe('t.userId = :userId');
    expect(calls[0]?.[1]).toEqual({ userId: USER });
  });

  it('applies pagination defaults (page 1, limit 20) and clamping', async () => {
    const { service } = makeService();
    let captured: FakeQb | undefined;
    const ds = new FakeDataSource();
    const origQb = ds.repo.createQueryBuilder.bind(ds.repo);
    ds.repo.createQueryBuilder = () => {
      captured = origQb();
      return captured;
    };
    const svc = new ArtboardsService(ds as never);

    await svc.list(USER, {} as QueryArtboardsDto);
    expect(captured?.skipValue).toBe(0);
    expect(captured?.takeValue).toBe(20);

    await svc.list(USER, { page: 3, limit: 999 } as never);
    expect(captured?.skipValue).toBe(200); // page 3 × clamped limit 100
    expect(captured?.takeValue).toBe(100);
  });

  it('searches title AND content with escaped LIKE wildcards', async () => {
    const { service } = makeService();
    const calls: unknown[][] = [];
    const ds = new FakeDataSource();
    const origQb = ds.repo.createQueryBuilder.bind(ds.repo);
    ds.repo.createQueryBuilder = () => {
      const qb = origQb();
      const origAnd = qb.andWhere.bind(qb);
      qb.andWhere = (...args: unknown[]) => {
        calls.push(args);
        return origAnd(...(args as [string]));
      };
      return qb;
    };
    const svc = new ArtboardsService(ds as never);

    await svc.list(USER, { search: '100%_done\\' } as never);
    expect(calls[0]?.[0]).toContain('t.title ILIKE');
    expect(calls[0]?.[0]).toContain('t.content ILIKE');
    // wildcards escaped so `100%` matches the literal text, not everything
    expect(calls[0]?.[1]).toEqual({ searchPattern: '%100\\%\\_done\\\\%' });
  });

  it('sorts by whitelisted columns only, defaulting to createdAt DESC', async () => {
    const { service } = makeService();
    const orderings: unknown[][] = [];
    const ds = new FakeDataSource();
    const origQb = ds.repo.createQueryBuilder.bind(ds.repo);
    ds.repo.createQueryBuilder = () => {
      const qb = origQb();
      const origOrder = qb.orderBy.bind(qb);
      qb.orderBy = (...args: unknown[]) => {
        orderings.push(args);
        return origOrder(...(args as [string, string]));
      };
      return qb;
    };
    const svc = new ArtboardsService(ds as never);

    await svc.list(USER, {} as QueryArtboardsDto);
    expect(orderings[orderings.length - 1]).toEqual(['t.createdAt', 'DESC']);

    await svc.list(USER, { sortBy: 'title', sortOrder: 'asc' } as never);
    expect(orderings[orderings.length - 1]).toEqual(['t.title', 'ASC']);
  });

  it('counts with the same filters and reports totalPages', async () => {
    const { service } = makeService();
    const ds = new FakeDataSource();
    ds.repo.qbRaw = { cnt: 45 };
    ds.repo.qbMany = [{ id: 'a', userId: USER }, { id: 'b', userId: USER }];
    const svc = new ArtboardsService(ds as never);

    const page = await svc.list(USER, { page: 2, limit: 20 } as never);
    expect(page).toMatchObject({ total: 45, page: 2, limit: 20, totalPages: 3 });
    expect(page.items).toHaveLength(2);
  });
});

describe('ArtboardsService — findOne / update / remove (ownership)', () => {
  const seed = (repo: FakeRepo) => {
    repo.artboards = [
      { id: 'a-1', userId: USER, title: 'mine', content: 'keep\nme' },
      { id: 'a-2', userId: OTHER, title: 'theirs', content: '' },
    ];
  };

  it('findOne returns own row and 404s another user’s id', async () => {
    const { service, ds } = makeService();
    seed(ds.repo);
    await expect(service.findOne(USER, 'a-1')).resolves.toMatchObject({ title: 'mine' });
    await expect(service.findOne(USER, 'a-2')).rejects.toThrow('Artboard a-2 not found');
  });

  it('update patches content verbatim and bumps updatedAt on the DB clock', async () => {
    const { service, ds } = makeService();
    seed(ds.repo);
    ds.repo.qbAffected = 1;

    const raw = '\n{"x":1}\n';
    const updated = await service.update(USER, 'a-1', { content: raw });
    // The UPDATE payload carries the verbatim content + DB-clock timestamp.
    expect(ds.repo.qbSets[0]?.[0]).toMatchObject({
      content: raw,
      updatedAt: expect.any(Function), // () => 'now()'
    });
    // The returned row is re-read from the repo (fake qb does not mutate it).
    expect(updated).toMatchObject({ id: 'a-1', userId: USER });
  });

  it('update 404s when the row belongs to another user (ownership in WHERE)', async () => {
    const { service, ds } = makeService();
    seed(ds.repo);
    ds.repo.qbAffected = 0; // 0 rows affected → not owner / not found
    await expect(service.update(USER, 'a-2', { title: 'hack' })).rejects.toThrow(
      'Artboard a-2 not found',
    );
  });

  it('update rejects an empty patch as 400', async () => {
    const { service } = makeService();
    await expect(service.update(USER, 'a-1', {})).rejects.toThrow(
      'At least one field to update is required',
    );
  });

  it('remove deletes own row only and 404s otherwise', async () => {
    const { service, ds } = makeService();
    seed(ds.repo);

    await expect(service.remove(USER, 'a-2')).rejects.toThrow('Artboard a-2 not found');
    expect(ds.repo.artboards).toHaveLength(2);

    await expect(service.remove(USER, 'a-1')).resolves.toEqual({ deleted: true, id: 'a-1' });
    expect(ds.repo.artboards).toHaveLength(1);
    expect(ds.repo.deletes[ds.repo.deletes.length - 1]).toEqual({ id: 'a-1', userId: USER });
  });
});
