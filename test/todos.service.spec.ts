import { TodosService } from '../src/modules/todos/todos.service';

/**
 * TodosService unit tests against a hand-rolled DataSource stub (same style as
 * admin.guard.spec.ts) — records every query/where/orderBy call so ownership
 * scoping, ordering and transactional behavior are checked without a real DB.
 */

interface TodoLike {
  id: string;
  userId: string;
  title: string;
  position: number;
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
    this.repo.compactExecuted += 1;
    return { affected: this.repo.qbAffected };
  }
}

class FakeRepo {
  todos: TodoLike[] = [];
  qbMany?: unknown[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  qbRaw?: any;
  qbAffected = 1;
  qbSets: unknown[][] = [];
  compactExecuted = 0;
  updates: { criteria: unknown; payload: unknown }[] = [];
  deletes: unknown[] = [];
  saved: unknown[] = [];

  createQueryBuilder(): FakeQb {
    return new FakeQb(this);
  }
  getRepository(): FakeRepo {
    return this;
  }
  async findOneBy(criteria: Partial<TodoLike>): Promise<TodoLike | undefined> {
    return this.todos.find((t) => t.id === criteria.id && t.userId === criteria.userId);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async update(criteria: unknown, payload: unknown): Promise<{ affected: number | undefined }> {
    const c = criteria as { id?: string; userId?: string };
    const matches = this.todos.filter((t) => t.id === c.id && t.userId === c.userId);
    for (const t of matches) {
      const p = payload as Partial<TodoLike>;
      if (typeof p.position === 'number') t.position = p.position;
    }
    this.updates.push({ criteria, payload });
    return { affected: matches.length };
  }
  async delete(criteria: unknown): Promise<{ affected: number }> {
    const c = criteria as { id?: string; userId?: string };
    const before = this.todos.length;
    this.todos = this.todos.filter((t) => !(t.id === c.id && t.userId === c.userId));
    this.deletes.push(criteria);
    return { affected: before - this.todos.length };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(input: any): TodoLike {
    return { ...input };
  }
  async save(input: TodoLike): Promise<TodoLike> {
    if (!input.id) {
      input.id = `gen-${this.saved.length + 1}`;
      this.todos.push(input);
    }
    this.saved.push(input);
    return input;
  }
  async find(opts: { where: { userId: string } }): Promise<TodoLike[]> {
    const rows = this.todos
      .filter((t) => t.userId === (opts.where as { userId: string }).userId)
      .sort((a, b) => a.position - b.position);
    return rows;
  }
}

const makeService = (repo: FakeRepo) =>
  new TodosService({
    isInitialized: true,
    initialize: async () => undefined,
    getRepository: () => repo,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: async (fn: any) => fn(repo),
  } as never);

const baseTodo = (id: string, position: number, userId = 'u1'): TodoLike => ({
  id,
  userId,
  title: id,
  position,
  status: 'pending',
  priority: 'medium',
  description: null,
  dueDate: null,
});

describe('TodosService — ownership scoping', () => {
  it('every entrypoint funnels through a userId-scoped where()', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const svc = makeService(repo);
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');

    await svc.list('u1', { search: 'x' } as never);
    await svc.create('u1', { title: 't', status: 'pending', priority: 'low' } as never);

    expect(qbSpy).toHaveBeenCalledTimes(2);
    for (const result of qbSpy.mock.results) {
      const qb = result.value as FakeQb;
      expect(qb.wheres.some((w: unknown[]) => JSON.stringify(w[1]).includes('"u1"'))).toBe(true);
    }
  });
});

describe('TodosService — list (pagination + search + sort)', () => {
  it('defaults: page 1/limit 20, createdAt desc, count runs with same filters', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [baseTodo('a', 0)];
    repo.qbRaw = { cnt: 45 };
    const svc = makeService(repo);
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const page = await svc.list('u1', {} as never);

    expect(page).toMatchObject({ total: 45, page: 1, limit: 20, totalPages: 3 });
    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.wheres[0][0]).toBe('t.userId = :userId');
    expect(qb.wheres[0][1]).toEqual({ userId: 'u1' });
    expect(qb.orderByCalls[0]).toEqual(['t.createdAt', 'DESC']);
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

  it('escapes LIKE wildcards in search (ILIKE + ESCAPE)', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    await svc.list('u1', { search: '100%_ off \\ now' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    const whereArgs = qb.wheres[1];
    expect(whereArgs[0]).toContain('ILIKE');
    expect(whereArgs[1].searchPattern).toBe('%100\\%\\_ off \\\\ now%');
  });

  it('filters by status and priority', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    await svc.list('u1', { status: 'done', priority: 'urgent' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.wheres.map((w: unknown[]) => w[0])).toEqual(
      expect.arrayContaining(['t.status = :status', 't.priority = :priority']),
    );
  });

  it('priority sort uses a rank CASE expression, not alphabetical order', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    await svc.list('u1', { sortBy: 'priority', sortOrder: 'asc' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.selectCalls[0][0]).toContain('CASE t.priority');
    expect(qb.selectCalls[0][0]).toContain("'urgent' THEN 3");
    expect(qb.orderByCalls[0]).toEqual(['priorityRank', 'ASC']);
  });

  it('position sort defaults to ascending; zero total → 0 totalPages', async () => {
    const repo = new FakeRepo();
    repo.qbMany = [];
    repo.qbRaw = { cnt: 0 };
    const qbSpy = jest.spyOn(repo, 'createQueryBuilder');
    const svc = makeService(repo);
    const page = await svc.list('u1', { sortBy: 'position' } as never);

    const qb = qbSpy.mock.results[0].value as FakeQb;
    expect(qb.orderByCalls[0]).toEqual(['t.position', 'ASC']);
    expect(page).toMatchObject({ total: 0, totalPages: 0 });
  });
});

describe('TodosService — create (transactional position assignment)', () => {
  const dto = (extra: Record<string, unknown> = {}) =>
    ({
      title: 'New todo',
      description: null,
      status: 'pending',
      priority: 'medium',
      dueDate: null,
      ...extra,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

  it('appends at MAX(position)+1 within a transaction', async () => {
    const repo = new FakeRepo();
    repo.todos = [baseTodo('a', 0), baseTodo('b', 1)];
    repo.qbRaw = { maxPos: '1' };
    const svc = makeService(repo);
    const todo = await svc.create('u1', dto());

    expect(todo.position).toBe(2);
    expect(todo.userId).toBe('u1');
    expect(repo.compactExecuted).toBe(0);
  });

  it('first todo starts at position 0', async () => {
    const repo = new FakeRepo();
    repo.todos = [];
    repo.qbRaw = { maxPos: null };
    const svc = makeService(repo);
    const todo = await svc.create('u1', dto());
    expect(todo.position).toBe(0);
  });

  it('honors an explicit position', async () => {
    const repo = new FakeRepo();
    repo.todos = [baseTodo('a', 0)];
    repo.qbRaw = { maxPos: '0' };
    const svc = makeService(repo);
    const todo = await svc.create('u1', dto({ position: 5 }));
    expect(todo.position).toBe(5);
  });
});

describe('TodosService — update (scoped by userId)', () => {
  it('returns 404 for another user’s todo (0 affected rows)', async () => {
    const repo = new FakeRepo();
    repo.qbAffected = 0; // scoped-WHHERE matches nothing
    repo.todos = [baseTodo('a', 0, 'someone-else')];
    const svc = makeService(repo);
    await expect(
      svc.update('u1', 'a', { title: 'x', status: 'done' } as never),
    ).rejects.toMatchObject({ status: 404 });
    // The UPDATE ran against a userId-scoped WHERE — never a cross-user write
    expect(repo.qbSets).toHaveLength(1);
    expect(await untouched(repo)).toBe(true);
  });

  async function untouched(repo: FakeRepo): Promise<boolean> {
    return repo.todos.every((t) => t.title === 'a');
  }

  it('updates own todo with DB-clock updatedAt', async () => {
    const repo = new FakeRepo();
    repo.todos = [baseTodo('a', 0)];
    const svc = makeService(repo);
    await svc.update('u1', 'a', { title: 'changed', status: 'done' } as never);
    const [setArgs] = repo.qbSets;
    const payload = setArgs[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ title: 'changed', status: 'done' });
    expect(String((payload.updatedAt as () => string)())).toBe('now()');
  });

  it('empty patch → 400', async () => {
    const svc = makeService(new FakeRepo());
    await expect(svc.update('u1', 'a', {} as never)).rejects.toMatchObject({ status: 400 });
  });
});

describe('TodosService — remove (gap compaction in a transaction)', () => {
  it('deletes own todo and shifts later positions down', async () => {
    const repo = new FakeRepo();
    repo.todos = [baseTodo('a', 0), baseTodo('b', 1), baseTodo('c', 2)];
    repo.qbRaw = { maxPos: '2' };
    const svc = makeService(repo);
    await svc.remove('u1', 'b');
    expect(repo.deletes).toContainEqual({ id: 'b', userId: 'u1' });
    expect(repo.compactExecuted).toBe(1);
  });

  it('404 for another user’s todo — nothing deleted', async () => {
    const repo = new FakeRepo();
    repo.todos = [baseTodo('a', 0, 'someone-else')];
    const svc = makeService(repo);
    await expect(svc.remove('u1', 'a')).rejects.toMatchObject({ status: 404 });
    expect(repo.deletes).toHaveLength(0);
    expect(repo.compactExecuted).toBe(0);
  });
});

describe('TodosService — reorder (transactional, gap-free)', () => {
  const svcFor = (repo: FakeRepo) => makeService(repo);

  it('404 when any id belongs to another user', async () => {
    const repo = new FakeRepo();
    repo.todos = [baseTodo('a', 0), baseTodo('b', 1)];
    const svc = svcFor(repo);
    await expect(
      svc.reorder('u1', { items: [{ id: 'stranger-id', position: 0 }] } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('400 on duplicate positions / out-of-range positions', async () => {
    const repo = new FakeRepo();
    repo.todos = [baseTodo('a', 0), baseTodo('b', 1)];
    const svc = svcFor(repo);
    await expect(
      svc.reorder('u1', {
        items: [
          { id: 'a', position: 0 },
          { id: 'b', position: 0 },
        ],
      } as never),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.reorder('u1', { items: [{ id: 'a', position: 5 }] } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('applies requested slots, then back-fills the rest in current order and writes only changed rows', async () => {
    const repo = new FakeRepo();
    repo.todos = [baseTodo('a', 0), baseTodo('b', 1), baseTodo('c', 2)];
    const svc = svcFor(repo);
    const result = await svc.reorder('u1', { items: [{ id: 'b', position: 0 }] } as never);

    expect(result.order).toEqual(['b', 'a', 'c']);
    // b→0, a→1 changed; c→2 unchanged → skipped
    const writes = repo.updates.reduce(
      (acc, u) => acc + ((u.payload as { position?: number }).position !== undefined ? 1 : 0),
      0,
    );
    expect(writes).toBe(2);
    expect(result).toMatchObject({ reordered: 2 });
  });

  it('full permutation writes only actual changes (same order → 0 writes)', async () => {
    const repo = new FakeRepo();
    repo.todos = [baseTodo('a', 0), baseTodo('b', 1), baseTodo('c', 2)];
    const svc = svcFor(repo);
    const result = await svc.reorder('u1', {
      items: [
        { id: 'a', position: 0 },
        { id: 'b', position: 1 },
        { id: 'c', position: 2 },
      ],
    } as never);
    expect(result.reordered).toBe(0);
    expect(repo.updates).toHaveLength(0);
  });
});
