import { PostsService } from '../src/modules/posts/posts.service';

/**
 * PostsService unit tests against a hand-rolled DataSource stub (same style
 * as todos.service.spec.ts) — records every SQL/param/where call so public
 * visibility, ownership scoping, one-vote-per-user and query optimization are
 * checked without a real DB.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

class FakeQb {
  calls: { method: string; args: unknown[] }[] = [];

  constructor(private readonly repo: FakeRepo) {}

  private rec(method: string, args: unknown[]): FakeQb {
    this.calls.push({ method, args });
    return this;
  }

  insert(): FakeQb {
    return this.rec('insert', []);
  }
  into(v: unknown): FakeQb {
    return this.rec('into', [v]);
  }
  values(v: unknown): FakeQb {
    return this.rec('values', [v]);
  }
  orIgnore(): FakeQb {
    return this.rec('orIgnore', []);
  }
  returning(v: unknown): FakeQb {
    return this.rec('returning', [v]);
  }
  delete(): FakeQb {
    return this.rec('delete', []);
  }
  from(v: unknown): FakeQb {
    return this.rec('from', [v]);
  }
  update(v: unknown): FakeQb {
    return this.rec('update', [v]);
  }
  set(v: unknown): FakeQb {
    return this.rec('set', [v]);
  }
  where(...args: unknown[]): FakeQb {
    return this.rec('where', args);
  }
  async execute(): Promise<{ affected: number | undefined; raw: unknown[] }> {
    return { affected: this.repo.qbAffected, raw: this.repo.qbRaw.slice(0) };
  }
}

class FakeRepo {
  store: AnyObj[] = [];
  deletes: unknown[] = [];
  saved: AnyObj[] = [];
  findCalls: Record<string, unknown>[] = [];
  qbs: FakeQb[] = [];
  /** RETURNING rows for or-ignore inserts — empty ⇒ conflict (dup vote). */
  qbRaw: AnyObj[] = [{ post_id: 'vote-1' }];
  qbAffected = 1;

  constructor(public readonly name: string) {}

  createQueryBuilder(): FakeQb {
    const qb = new FakeQb(this);
    this.qbs.push(qb);
    return qb;
  }

  async findOneBy(criteria: Record<string, unknown>): Promise<AnyObj | undefined> {
    this.findCalls.push({ ...criteria });
    return this.store.find((row) => Object.entries(criteria).every(([k, v]) => row[k] === v));
  }

  create(input: AnyObj): AnyObj {
    return { ...input };
  }

  async save(input: AnyObj): Promise<AnyObj> {
    const row = { id: `post-${this.saved.length + 1}`, ...input };
    this.store.push(row);
    this.saved.push(row);
    return row;
  }

  async delete(criteria: unknown): Promise<{ affected: number }> {
    this.deletes.push(criteria);
    const c = criteria as { id?: string; userId?: string };
    const before = this.store.length;
    this.store = this.store.filter(
      (row) => !(row.id === c.id && (c.userId === undefined || row.userId === c.userId)),
    );
    return { affected: before - this.store.length };
  }
}

class FakeDS {
  isInitialized = true;
  queryCalls: { sql: string; params: unknown[] }[] = [];
  /** Each call consumes the next configured result set (default: no rows). */
  queryQueue: unknown[][] = [];
  private nextIdx = 0;
  private repos: Map<string, FakeRepo>;

  constructor(repos: FakeRepo[]) {
    this.repos = new Map(repos.map((r) => [r.name, r]));
  }

  async initialize(): Promise<unknown> {
    return this;
  }

  getRepository(entity: abstract new () => unknown): FakeRepo {
    const name = (entity as { name: string }).name;
    const repo = this.repos.get(name);
    if (!repo) throw new Error(`No fake repo registered for ${name}`);
    return repo;
  }

  /** Test-side accessor: grab a fake repo without importing any entity. */
  repoByName(name: string): FakeRepo {
    const repo = this.repos.get(name);
    if (!repo) throw new Error(`No fake repo registered for ${name}`);
    return repo;
  }

  async query(sql: string, params: unknown[]): Promise<unknown[]> {
    this.queryCalls.push({ sql, params });
    const next = this.queryQueue[this.nextIdx];
    this.nextIdx += 1;
    return next ?? [];
  }
}

const makeService = (ds: FakeDS): PostsService => new PostsService(ds as never);

const VIEW_ROW = {
  id: 'post-1',
  userId: 'author-1',
  resourceType: 'todo',
  resourceId: 'res-1',
  title: 'Fresh ad',
  description: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  authorUsername: 'ad_author',
  authorName: 'Ad Author',
  authorImage: 'http://img',
  voteCount: 7,
  hasVoted: true,
};

const uuid = '0b9e6c50-1f2e-4a3c-8d5b-2a1f3e4c5b6a';

const postRepoOf = (ds: FakeDS): FakeRepo => ds.repoByName('Post');

describe('PostsService — public feed', () => {
  it('runs ONE page query + ONE count query with the same filters (count params excluded)', async () => {
    const ds = new FakeDS([]);
    ds.queryQueue = [[VIEW_ROW], [{ cnt: 7 }]];
    const page = await makeService(ds).feed({} as never, null);

    expect(page).toMatchObject({ total: 7, page: 1, limit: 20, totalPages: 1 });
    const [pageCall, countCall] = ds.queryCalls;
    expect(pageCall.sql).toContain('FROM post p');
    expect(pageCall.sql).toContain('LEFT JOIN "user" u');
    expect(pageCall.sql).toContain('LIMIT $1 OFFSET $2');
    expect(pageCall.params).toEqual([20, 0]);
    // No viewer: literal false hasVoted — the EXISTS subquery is not emitted.
    expect(pageCall.sql).toContain('false AS "hasVoted"');
    expect(pageCall.sql).not.toContain('EXISTS');
    // Count keeps the filters (here: none) and never scans post_vote twice.
    expect(countCall.sql).toContain('SELECT COUNT(*)::int AS "cnt" FROM post p');
    expect(countCall.params).toEqual([]);
  });

  it('scopes hasVoted via EXISTS($user) only for signed-in viewers', async () => {
    const ds = new FakeDS([]);
    ds.queryQueue = [[VIEW_ROW], [{ cnt: 3 }]];
    await makeService(ds).feed({} as never, 'viewer-9');

    const pageCall = ds.queryCalls[0];
    expect(pageCall.params).toEqual(['viewer-9', 20, 0]);
    expect(pageCall.sql).toContain(
      'EXISTS (SELECT 1 FROM post_vote hv WHERE hv.post_id = p.id AND hv.user_id = $1)',
    );
  });

  it('escapes LIKE wildcards in feed search', async () => {
    const ds = new FakeDS([]);
    ds.queryQueue = [[], [{ cnt: 0 }]];
    await makeService(ds).feed({ search: '100%_ off \\ now' } as never, null);

    const pageCall = ds.queryCalls[0];
    expect(pageCall.sql).toContain('ILIKE $1 ESCAPE');
    expect(pageCall.sql).toContain('p.description ILIKE $2 ESCAPE');
    expect(pageCall.params[0]).toBe('%100\\%\\_ off \\\\ now%');
    expect(pageCall.params[1]).toBe('%100\\%\\_ off \\\\ now%');
  });

  it('filters by resource type and sorts by vote count with the alias + stable tie-breaker', async () => {
    const ds = new FakeDS([]);
    ds.queryQueue = [[], [{ cnt: 5 }]];
    await makeService(ds).feed(
      { resourceType: 'component', sortBy: 'votes', sortOrder: 'asc' } as never,
      null,
    );

    const pageCall = ds.queryCalls[0];
    expect(pageCall.sql).toContain('p.resource_type = $1');
    expect(pageCall.params[0]).toBe('component');
    expect(pageCall.sql).toContain('ORDER BY "voteCount" ASC, p.created_at DESC, p.id ASC');
    // voteCount is one correlated subquery on post_vote — no extra round-trip.
    expect(pageCall.sql).toContain('(SELECT COUNT(*)::int FROM post_vote v WHERE v.post_id = p.id)');
  });

  it('mine pins author_id to the caller and still honors filters', async () => {
    const ds = new FakeDS([]);
    ds.queryQueue = [[], [{ cnt: 2 }]];
    await makeService(ds).mine('u1', { resourceType: 'snippet' } as never);

    const pageCall = ds.queryCalls[0];
    expect(pageCall.sql).toContain('WHERE p.user_id = $1');
    expect(pageCall.sql).toContain('AND p.resource_type = $2');
    expect(pageCall.params.slice(0, 2)).toEqual(['u1', 'snippet']);
    // COUNT runs with exactly the same conditions.
    expect(ds.queryCalls[1].sql).toContain('p.user_id = $1');
    expect(ds.queryCalls[1].params).toEqual(['u1', 'snippet']);
  });

  it('clamps pagination like every module (limit 100 max)', async () => {
    const ds = new FakeDS([]);
    ds.queryQueue = [[], [{ cnt: 0 }]];
    await makeService(ds).feed({ page: 3, limit: 1000 } as never, null);
    expect(ds.queryCalls[0].params).toEqual([100, 200]);
  });
});

describe('PostsService — findOne', () => {
  it('returns author + voteCount + viewer state', async () => {
    const ds = new FakeDS([]);
    ds.queryQueue = [[VIEW_ROW]];
    const view = await makeService(ds).findOne('post-1', 'viewer-9');

    expect(view).toMatchObject({
      id: 'post-1',
      author: { id: 'author-1', username: 'ad_author' },
      voteCount: 7,
      hasVoted: true,
    });
    const call = ds.queryCalls[0];
    expect(call.params).toEqual(['post-1', 'viewer-9']);
    expect(call.sql).toContain('u.username AS "authorUsername"');
  });

  it('404 when the post does not exist', async () => {
    const ds = new FakeDS([]);
    await expect(makeService(ds).findOne('post-1', null)).rejects.toMatchObject({ status: 404 });
  });
});

describe('PostsService — create (publish owned resource)', () => {
  const todoDto = {
    resourceType: 'todo',
    resourceId: uuid,
    title: 'Look',
    description: null,
  } as never;

  const makeDs = (resourceStore: AnyObj[] = [{ id: uuid, userId: 'u1', title: 'my todo' }]): FakeDS => {
    const todoRepo = new FakeRepo('Todo');
    todoRepo.store = resourceStore;
    const ds = new FakeDS([todoRepo, new FakeRepo('Post')]);
    ds.queryQueue = [[VIEW_ROW]]; // post-create findOne(view) replay
    return ds;
  };

  it('publishes with ownerId=caller — the resource row is REFERENCED, not copied', async () => {
    const ds = makeDs();
    const view = await makeService(ds).create('u1', todoDto);

    expect(postRepoOf(ds).saved).toHaveLength(1);
    expect(postRepoOf(ds).saved[0]).toMatchObject({
      userId: 'u1',
      resourceType: 'todo',
      resourceId: uuid, // a pointer only — no todo fields in the payload
    });
    expect(view).toMatchObject({ author: { username: 'ad_author' }, voteCount: 7 });
  });

  it('checks ownership with id AND userId in the same lookup', async () => {
    const ds = makeDs();
    await makeService(ds).create('u1', todoDto);

    const findCalls = ds.repoByName('Todo').findCalls;
    expect(findCalls).toHaveLength(1);
    expect(findCalls[0]).toEqual({ id: uuid, userId: 'u1' });
  });

  it('404 for someone else’s resource (ownership scope includes userId)', async () => {
    const ds = makeDs([{ id: uuid, userId: 'someone-else', title: 'not mine' }]);
    await expect(makeService(ds).create('u1', todoDto)).rejects.toMatchObject({ status: 404 });
    expect(postRepoOf(ds).saved).toHaveLength(0);
  });

  it('409 when the resource is already published (uq_post_resource 23505)', async () => {
    const todoRepo = new FakeRepo('Todo');
    todoRepo.store = [{ id: uuid, userId: 'u1' }];
    const postRepo = new FakeRepo('Post');
    // TypeORM surfaces the driver code through the error chain.
    const conflict = Object.assign(new Error('duplicate key'), { code: '23505' });
    postRepo.save = async () => {
      throw conflict;
    };
    const ds = new FakeDS([todoRepo, postRepo]);
    await expect(makeService(ds).create('u1', todoDto)).rejects.toMatchObject({ status: 409 });
  });
});

describe('PostsService — update/remove (owner-only management)', () => {
  it('update writes via a scoped UPDATE (id + user_id) with DB-clock updatedAt', async () => {
    const postRepo = new FakeRepo('Post');
    const ds = new FakeDS([postRepo]);
    ds.queryQueue = [[VIEW_ROW]];
    await makeService(ds).update('u1', 'post-1', { title: 'renamed', description: null } as never);

    const calls = postRepo.qbs[0].calls;
    expect(calls[0]).toMatchObject({ method: 'update' });
    const setPayload = calls[1].args[0] as Record<string, unknown>;
    expect(setPayload).toMatchObject({ title: 'renamed', description: null });
    expect(String((setPayload.updatedAt as () => string)())).toBe('now()');
    // Ownership lives in the WHERE clause — other users' rows are unreachable.
    expect(calls[2].args[1]).toEqual({ id: 'post-1', userId: 'u1' });
  });

  it('update → 404 when the scoped UPDATE matches nothing (foreign post)', async () => {
    const postRepo = new FakeRepo('Post');
    postRepo.qbAffected = 0; // `WHERE id AND user_id` matched nothing
    postRepo.store = [{ id: 'post-1', userId: 'stranger', title: 'a' }];
    const ds = new FakeDS([postRepo]);
    await expect(
      makeService(ds).update('u1', 'post-1', { title: 'hijack' } as never),
    ).rejects.toMatchObject({ status: 404 });
    expect(postRepo.store[0].title).toBe('a'); // untouched
  });

  it('update rejects an empty patch with 400', async () => {
    const ds = new FakeDS([new FakeRepo('Post')]);
    await expect(makeService(ds).update('u1', 'post-1', {} as never)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('remove deletes via scoped criteria ({id, userId}) — votes cascade by FK', async () => {
    const postRepo = new FakeRepo('Post');
    postRepo.store = [{ id: 'post-1', userId: 'u1' }];
    const ds = new FakeDS([postRepo]);
    const result = await makeService(ds).remove('u1', 'post-1');

    expect(result).toEqual({ deleted: true, id: 'post-1' });
    expect(postRepo.deletes).toContainEqual({ id: 'post-1', userId: 'u1' });
  });

  it('remove → 404 for another user’s post — foreign rows untouched', async () => {
    const postRepo = new FakeRepo('Post');
    postRepo.store = [{ id: 'post-1', userId: 'stranger' }];
    const ds = new FakeDS([postRepo]);
    await expect(makeService(ds).remove('u1', 'post-1')).rejects.toMatchObject({ status: 404 });
    // The DELETE ran with ownership in its criteria — and matched nothing.
    expect(postRepo.deletes).toContainEqual({ id: 'post-1', userId: 'u1' });
    expect(postRepo.store).toHaveLength(1); // stranger's post survives
  });
});

describe('PostsService — votes (one per user per post)', () => {
  interface DsOpts {
    postExists: boolean;
    /** RETURNING rows for the upvote insert — [] means silent dup skip. */
    voteRaw: AnyObj[];
    /** affected rows of the un-vote DELETE. */
    affected?: number;
  }

  const makeDs = ({
    postExists,
    voteRaw,
    affected = 1,
  }: DsOpts): { ds: FakeDS; postRepo: FakeRepo; voteRepo: FakeRepo } => {
    const postRepo = new FakeRepo('Post');
    postRepo.store = postExists ? [{ id: 'post-1', userId: 'author-1' }] : [];
    postRepo.qbRaw = voteRaw;
    const voteRepo = new FakeRepo('PostVote');
    voteRepo.qbRaw = voteRaw;
    voteRepo.qbAffected = affected;
    const ds = new FakeDS([postRepo, voteRepo]);
    ds.queryQueue = [[{ cnt: 8 }]]; // countVotes replay
    return { ds, postRepo, voteRepo };
  };

  it('casts the vote with one or-ignore insert', async () => {
    const { ds, voteRepo } = makeDs({ postExists: true, voteRaw: [{ post_id: 'x' }] });
    const result = await makeService(ds).addVote('voter-1', 'post-1');

    expect(result).toEqual({ postId: 'post-1', hasVoted: true, voteCount: 8 });
    const methods = voteRepo.qbs[0].calls.map((c) => c.method);
    expect(methods).toEqual(['insert', 'into', 'values', 'orIgnore', 'returning']);
    // Composite-PK insert: post_id + user_id — duplicates cannot exist twice.
    expect(voteRepo.qbs[0].calls[2].args[0]).toMatchObject({ postId: 'post-1', userId: 'voter-1' });
    expect(voteRepo.qbs[0].calls[3].method).toBe('orIgnore');
  });

  it('409 on the second vote (ON CONFLICT DO NOTHING → no RETURNING rows)', async () => {
    const { ds, voteRepo } = makeDs({ postExists: true, voteRaw: [] });
    await expect(makeService(ds).addVote('voter-1', 'post-1')).rejects.toMatchObject({
      status: 409,
    });
    expect(voteRepo.qbs).toHaveLength(1); // the one skipped insert only
  });

  it('404 when the post does not exist — no vote insert attempted', async () => {
    const { ds, voteRepo } = makeDs({ postExists: false, voteRaw: [{ post_id: 'x' }] });
    await expect(makeService(ds).addVote('voter-1', 'post-1')).rejects.toMatchObject({
      status: 404,
    });
    expect(voteRepo.qbs).toHaveLength(0);
  });

  it('unvote deletes the caller’s own vote only and reports the fresh count', async () => {
    const { ds, voteRepo } = makeDs({ postExists: true, voteRaw: [{ post_id: 'x' }] });
    ds.queryQueue = [[{ cnt: 7 }]];
    const result = await makeService(ds).removeVote('voter-1', 'post-1');

    expect(result).toEqual({ postId: 'post-1', hasVoted: false, voteCount: 7 });
    const calls = voteRepo.qbs[0].calls;
    expect(calls[0]).toMatchObject({ method: 'delete' });
    // Scoped delete: user_id in the WHERE clause.
    expect(calls[2].args[1]).toEqual({ postId: 'post-1', userId: 'voter-1' });
  });

  it('unvote → 404 for a never-cast vote', async () => {
    const { ds, voteRepo } = makeDs({ postExists: true, voteRaw: [{ post_id: 'x' }], affected: 0 });
    await expect(makeService(ds).removeVote('voter-1', 'post-1')).rejects.toMatchObject({
      status: 404,
    });
    expect(voteRepo.qbs).toHaveLength(1);
  });
});
