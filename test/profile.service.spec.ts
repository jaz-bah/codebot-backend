/** No real auth DB in unit tests — the auth-DB handle is a mock. */
jest.mock('../src/database/kysely/auth-db', () => ({
  getAuthKysely: jest.fn() as unknown,
}));

import { ProfileService } from '../src/modules/profile/profile.service';
import { Profile } from '../src/database/typeorm/entities/profile.entity';
import { updateProfileSchema } from '../src/modules/profile/dto/update-profile.dto';
import { getAuthKysely } from '../src/database/kysely/auth-db';

const mockedGetAuthKysely = getAuthKysely as unknown as jest.Mock;

beforeEach(() => mockedGetAuthKysely.mockImplementation(() => null));
afterEach(() => mockedGetAuthKysely.mockReset());

/**
 * ProfileService unit tests against hand-rolled fakes — lazy get-or-create
 * (incl. unique-violation retry races), the single-round-trip counts query
 * (ownership + shape), nickname claiming (409 on clash, idempotent same-value)
 * and rotate.
 */

type FakeAuthRow = {
  username: string | null;
  email: string;
  name: string;
  image: string | null;
};

/** Kysely-shaped fake of the auth-DB: reads return `currentRow`, writes merge. */
const fakeAuthDb = ({ initialRow }: { initialRow: FakeAuthRow }) => {
  let currentRow: FakeAuthRow = initialRow;
  const updateSets: Array<Record<string, unknown>> = [];
  let failUpdates = false;
  const db = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          executeTakeFirst: async () => currentRow,
          execute: async () => (currentRow.username ? [{ username: currentRow.username }] : []),
        }),
      }),
    }),
    updateTable: () => ({
      set: (set: Record<string, unknown>) => {
        if (failUpdates) throw new Error('auth write failed');
        updateSets.push(set);
        currentRow = { ...currentRow, ...set } as FakeAuthRow;
        return { where: () => ({ execute: async () => [] }) };
      },
    }),
  };
  return {
    db,
    updateSets,
    failures: {
      failUpdates: () => {
        failUpdates = true;
      },
    },
    row: () => currentRow,
  };
};

class FakeRepo {
  rows: Profile[] = [];
  usersWithRows = new Set<string>();
  saved: Array<Partial<Profile>> = [];
  updates: Array<{ where: unknown; set: Partial<Profile> }> = [];

  private nextId = 1;

  async findOne(q: { where: { userId?: string; nickname?: string } }): Promise<Profile | null> {
    if (q.where.userId) return this.rows.find((r) => r.userId === q.where.userId) ?? null;
    if (q.where.nickname) return this.rows.find((r) => r.nickname === q.where.nickname) ?? null;
    return null;
  }

  create(input: { userId: string; nickname: string }): Profile {
    return {
      id: `row-${this.nextId++}`,
      ...input,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Profile;
  }

  async save(row: Profile): Promise<Profile> {
    // Mirror the DB's unique indexes: one row per user, nicknames global.
    if (this.usersWithRows.has(row.userId)) throw { code: '23505', detail: 'user_id' };
    if (this.rows.some((r) => r.nickname === row.nickname)) throw { code: '23505', detail: 'nickname' };
    this.usersWithRows.add(row.userId);
    this.rows.push(row);
    this.saved.push(row);
    return row;
  }

  async update(where: { userId: string }, set: Partial<Profile>): Promise<void> {
    this.updates.push({ where, set });
    const row = this.rows.find((r) => r.userId === where.userId);
    if (!row) throw { code: '23505', detail: 'user_id' }; // FK-ish guard for tests
    if (set.nickname && this.rows.some((r) => r.nickname === set.nickname && r.userId !== where.userId)) {
      throw { code: '23505', detail: 'nickname' };
    }
    row.nickname = set.nickname ?? row.nickname;
    row.updatedAt = (set.updatedAt as Date) ?? row.updatedAt;
  }
}

const make = (databaseUrl = '') => {
  const repo = new FakeRepo();
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const dataSource = {
    isInitialized: true,
    initialize: jest.fn(),
    getRepository: () => repo,
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      // One aggregate row; counts reflect ONLY the params[0] user.
      const [user] = params as string[];
      return [
        {
          todos: user === 'u1' ? 2 : 0,
          notes: 1,
          files: 3,
          folders: 1,
          documents: 0,
          components: 1,
          presets: 4,
          experts: 0,
          tools: 0,
          snippets: 0,
        },
      ];
    },
  };
  return {
    svc: new ProfileService(dataSource as never, { databaseUrl } as never),
    repo,
    queries,
  };
};

const otherUserRow = (repo: FakeRepo): void => {
  repo.rows.push({
    id: 'other',
    userId: 'someone-else',
    nickname: 'cbtaken',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Profile);
};

describe('ProfileService — get-or-create + nickname recipes', () => {
  it('first GET creates the row with an auto-generated cb-handle', async () => {
    const { svc, repo } = make();
    const view = await svc.view('u1');
    expect(view.nickname).toMatch(/^cb[a-z2-9]{5}$/);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].userId).toBe('u1');
  });

  it('second GET reuses the SAME nickname (no re-create)', async () => {
    const { svc, repo } = make();
    const first = await svc.view('u1');
    const second = await svc.view('u1');
    expect(second.nickname).toBe(first.nickname);
    expect(repo.rows).toHaveLength(1);
  });

  it('collides with an existing nickname keep retrying generation', async () => {
    const { svc, repo } = make();
    otherUserRow(repo);
    // Force the first two draws to produce 'cbtaken' (t,a,k,e,n alphabet
    // slots), then let fresh randomness through — the retry loop must win.
    const crypto = require('crypto');
    const forced = Buffer.from([16, 0, 9, 4, 11]); // → 'cbtaken'
    const spy = jest
      .spyOn(crypto, 'randomBytes')
      .mockImplementationOnce(() => forced)
      .mockImplementationOnce(() => forced);
    const view = await svc.view('u1');
    expect(view.nickname).not.toBe('cbtaken');
    expect(view.nickname).toMatch(/^cb[a-z2-9]{5}$/);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3); // retried past collisions
    spy.mockRestore();
  });

  it('two users never share a nickname (each row independent)', async () => {
    const { svc } = make();
    const a = await svc.view('u1');
    const b = await svc.view('u2');
    expect(a.nickname).not.toBe(b.nickname);
  });
});

describe('ProfileService — live counts', () => {
  it('one aggregate SQL round-trip, parameterized by the session user', async () => {
    const { svc, queries } = make();
    const view = await svc.view('u1');
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual(['u1']);
    const sql = queries[0].sql;
    for (const table of ['todo', 'note', 'workspace_file', 'document', 'component', 'preset', 'expert', 'tool', 'ide_snippet']) {
      expect(sql).toContain(`from "${table}"`);
    }
    expect(view.counts).toEqual({
      todos: 2,
      notes: 1,
      files: 3,
      folders: 1,
      documents: 0,
      components: 1,
      presets: 4,
      experts: 0,
      tools: 0,
      snippets: 0,
    });
  });

  it('workspace_file counts split files from folders', async () => {
    const { svc, queries } = make();
    await svc.view('u1');
    const sql = queries[0].sql;
    expect(sql).toContain("\"type\" = 'file'");
    expect(sql).toContain("\"type\" = 'folder'");
  });

  it('counts come straight from the user parameter — never another user', async () => {
    const { svc, queries } = make();
    const view = await svc.view('u2');
    expect(queries[0].params).toEqual(['u2']);
    expect(view.counts.todos).toBe(0); // u1's 2 todos are invisible to u2
  });
});

describe('ProfileService — PATCH nickname', () => {
  it('claims a free nickname and persists it', async () => {
    const { svc, repo } = make();
    await svc.view('u1');
    const view = await svc.update('u1', { nickname: 'my-handle' });
    expect(view.nickname).toBe('my-handle');
    expect(repo.updates).toHaveLength(1);
  });

  it('claiming a nickname taken by ANOTHER user → 409', async () => {
    const { svc, repo } = make();
    otherUserRow(repo);
    await expect(svc.update('u1', { nickname: 'cbtaken' })).rejects.toMatchObject({ status: 409 });
  });

  it('re-claiming your own nickname is idempotent (no 409 loop)', async () => {
    const { svc, repo } = make();
    await svc.update('u1', { nickname: 'my-handle' }); // first claim
    const view = await svc.update('u1', { nickname: 'my-handle' });
    expect(view.nickname).toBe('my-handle');
    expect(repo.updates).toHaveLength(1); // second call short-circuits
  });
});

describe('ProfileService — rotate', () => {
  it('discards the old handle and produces a NEW unique one', async () => {
    const { svc, repo } = make();
    const before = await svc.view('u1');
    const after = await svc.rotate('u1');
    expect(after.nickname).not.toBe(before.nickname);
    expect(after.nickname).toMatch(/^cb[a-z2-9]{5}$/);
    expect(repo.updates.length).toBeGreaterThan(0);
  });
});

describe('updateProfileSchema (joi)', () => {
  const at = (value: unknown) => updateProfileSchema.validate({ nickname: value });

  it('accepts and LOWERCASES a valid slug', () => {
    const { value, error } = at('  CoolRotor_9 ');
    expect(error).toBeUndefined();
    expect(value.nickname).toBe('coolrotor_9');
  });

  it('rejects too-short, too-long and invalid-character nicknames', () => {
    expect(at('ab').error).toBeDefined();
    expect(at('a'.repeat(25)).error).toBeDefined();
    expect(at('Has Space').error).toBeDefined();
    expect(at('has.dot').error).toBeDefined();
    expect(at('has@at').error).toBeDefined();
    expect(at('').error).toBeDefined();
    expect(at(undefined).error).toBeDefined();
  });
});

describe('ProfileService — user resolution', () => {
  const authUser = (username: string) => ({
    id: 'u1',
    email: 'jane@x.io',
    name: 'Jane Doe',
    username,
    emailVerified: true,
    role: 'user',
    image: null,
  });

  it('echoes the session authUser when it already carries a username (no extra auth-DB round-trip)', async () => {
    mockedGetAuthKysely.mockClear();
    const { svc } = make('db://stub');
    const view = await svc.view('u1', authUser('jane'));
    expect(view.user).toMatchObject({ id: 'u1', username: 'jane', email: 'jane@x.io' });
    expect(mockedGetAuthKysely).not.toHaveBeenCalled();
  });

  it('reads the auth row when the session lacks a username', async () => {
    const f = fakeAuthDb({ initialRow: { username: 'jane', email: 'jane@x.io', name: 'Jane', image: null } });
    mockedGetAuthKysely.mockReturnValue(f.db);
    const { svc } = make('db://stub');
    const view = await svc.view('u1');
    expect(view.user.username).toBe('jane');
  });

  it('user info degrades to session data (username null) when the auth DB is unreachable', async () => {
    mockedGetAuthKysely.mockImplementation(() => {
      throw new Error('boom');
    });
    const { svc } = make('db://stub');
    const view = await svc.view('u1');
    expect(view.user.username).toBeNull();
    expect(view.nickname).toMatch(/^cb[a-z2-9]{5}$/); // profile still resolves
  });
});

describe('ProfileService — lazy username backfill (legacy rows)', () => {
  it('allocates + persists a unique username for a legacy row without one', async () => {
    const f = fakeAuthDb({ initialRow: { username: null, email: 'john.doe@x.io', name: 'John Doe', image: null } });
    mockedGetAuthKysely.mockReturnValue(f.db);
    const { svc, queries } = make('db://stub');
    const view = await svc.view('u1');
    expect(view.user.username).toBe('john.doe');
    expect(queries).toHaveLength(1); // counts unchanged in shape
  });

  it('a taken base handle falls back to a suffixed variant', async () => {
    const f = fakeAuthDb({ initialRow: { username: null, email: 'john.doe@x.io', name: 'John Doe', image: null } });
    mockedGetAuthKysely.mockReturnValue(f.db);
    // Simulate 'john.doe' being taken in the username-uniqueness query.
    f.db.selectFrom = () => ({
      select: () => ({
        where: () => ({
          executeTakeFirst: async () => f.row(),
          execute: async () => [{ username: 'john.doe' }],
        }),
      }),
    }) as never;
    const { svc } = make('db://stub');
    const view = await svc.view('u1');
    expect(view.user.username).toMatch(/^john\.doe_[a-z2-9]{3}$/);
  });

  it('a failed backfill never breaks the profile (username stays null)', async () => {
    const f = fakeAuthDb({ initialRow: { username: null, email: 'john.doe@x.io', name: 'John Doe', image: null } });
    mockedGetAuthKysely.mockReturnValue(f.db);
    f.failures.failUpdates();
    const { svc } = make('db://stub');
    const view = await svc.view('u1');
    expect(view.user.username).toBeNull();
  });
});

describe('ProfileService — profile image (PATCH/DELETE)', () => {
  const initialRow = { username: 'jane', email: 'jane@x.io', name: 'Jane', image: null };
  const url = 'https://res.cloudinary.com/demo/image/upload/profile.png';

  it('setImage persists user.image and returns the FRESH view', async () => {
    const f = fakeAuthDb({ initialRow });
    mockedGetAuthKysely.mockReturnValue(f.db);
    const { svc } = make('db://stub');
    const view = await svc.setImage('u1', url);
    expect(view.user.image).toBe(url); // fresh row read, not the (stale) write input
    expect(f.updateSets[0]).toMatchObject({ image: url });
    expect(view.counts.todos).toBeDefined();
  });

  it('clearImage nulls user.image and returns the fresh view', async () => {
    const f = fakeAuthDb({ initialRow: { ...initialRow, image: url } });
    mockedGetAuthKysely.mockReturnValue(f.db);
    const { svc } = make('db://stub');
    const view = await svc.clearImage('u1');
    expect(view.user.image).toBeNull();
    expect(f.updateSets[0]).toMatchObject({ image: null });
  });

  it('image write failure → 503, before any view is returned', async () => {
    const f = fakeAuthDb({ initialRow: { ...initialRow, image: url } });
    mockedGetAuthKysely.mockReturnValue(f.db);
    f.failures.failUpdates();
    const { svc } = make('db://stub');
    await expect(svc.setImage('u1', url)).rejects.toMatchObject({ status: 503 });
  });
});
