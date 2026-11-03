import { SearchService } from '../src/modules/search/search.service';

/**
 * SearchService unit tests against hand-rolled fakes — query parsing
 (@scopes + aliases + unknown tokens), term extraction, per-scope runs
 (ownership scoping, cap), parallel fan-out and merged ordering.
 */

interface QbSpy {
  calls: string[];
  result: unknown[];
}

class FakeQb {
  constructor(
    private readonly spy: QbSpy,
    private readonly repo: FakeRepo,
  ) {}
  where(sql: string): FakeQb {
    this.spy.calls.push(`where(${sql})`);
    return this;
  }
  andWhere(sql: string): FakeQb {
    this.spy.calls.push(`andWhere(${sql})`);
    return this;
  }
  orderBy(...args: unknown[]): FakeQb {
    this.spy.calls.push(`orderBy(${args.join(' ')})`);
    return this;
  }
  leftJoin(): FakeQb {
    return this;
  }
  select(...args: unknown[]): FakeQb {
    this.spy.calls.push(`select(${args[0]})`);
    return this;
  }
  addSelect(...args: unknown[]): FakeQb {
    this.spy.calls.push(`addSelect(${args[0]})`);
    return this;
  }
  take(v: number): FakeQb {
    this.spy.calls.push(`take(${v})`);
    return this;
  }
  async getMany(): Promise<unknown[]> {
    this.spy.calls.push('getMany');
    return this.repo.rows;
  }
  async getRawMany<T>(): Promise<T[]> {
    this.spy.calls.push('getRawMany');
    return this.repo.rawRows as unknown as T[];
  }
}

class FakeRepo {
  spy: QbSpy = { calls: [], result: [] };
  rows: unknown[] = [];
  rawRows: unknown[] = [];

  createQueryBuilder(): FakeQb {
    return new FakeQb(this.spy, this);
  }
}

const makeDeps = () => {
  const repos: Record<string, FakeRepo> = {};
  const getRepo = (cls: { name: string }): FakeRepo => {
    const key = cls.name;
    if (!repos[key]) repos[key] = new FakeRepo();
    return repos[key];
  };
  const dataSource = {
    isInitialized: true,
    initialize: jest.fn(),
    getRepository: (cls: { name: string }) => getRepo(cls),
  };
  const svc = new SearchService(dataSource as never);
  return { svc, repos, getRepo };
};

const HIT = (id: string, updatedAt: Date) => ({ id, updatedAt });

describe('SearchService — parse', () => {
  it('extracts scope tokens and the residual term', () => {
    const { svc } = makeDeps();
    expect(svc.parse('@presets invoice-sync')).toEqual({ scopes: ['presets'], term: 'invoice-sync' });
    expect(svc.parse('my @todos fix + @notes essay')).toEqual({
      scopes: ['todos', 'notes'],
      term: 'my fix + essay',
    });
    expect(svc.parse('search me')).toEqual({ scopes: null, term: 'search me' });
    expect(svc.parse('@presets')).toEqual({ scopes: ['presets'], term: null }); // recent browse
  });

  it('supports singular aliases and is case-insensitive', () => {
    const { svc } = makeDeps();
    expect(svc.parse('@Preset x').scopes).toEqual(['presets']); // alias 'preset'
    expect(svc.parse('@TODOS x').scopes).toEqual(['todos']);
    expect(svc.parse('@ide-snippet x').scopes).toEqual(['snippets']); // singular alias
  });

  it('rejects unknown scopes with the supported list', () => {
    const { svc } = makeDeps();
    const supported = 'todos, notes, files, documents, components, presets, experts, tools, snippets';
    expect(() => svc.parse('@widgets x')).toThrow(/Unknown search scope "@widgets"/);
    expect(() => svc.parse('@widgets x')).toThrow(new RegExp(supported.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('treats a bare @ as plain text, not a token (stripped from the search term)', () => {
    const { svc } = makeDeps();
    expect(svc.parse('email me @ x')).toEqual({ scopes: null, term: 'email me x' });
  });

  it('400s when there is neither a term nor a scope', async () => {
    const { svc } = makeDeps();
    await expect(svc.search('u1', { q: '   ', limit: 10 })).rejects.toMatchObject({ status: 400 });
  });
});

describe('SearchService — search', () => {
  it('queries ONLY the requested scopes, scoped by user and capped', async () => {
    const { svc, getRepo } = makeDeps();
    getRepo({ name: 'Preset' }).rows = [HIT('p1', new Date(2))];
    await svc.search('u1', { q: '@presets invoice', limit: 3 });

    const presetSpy = getRepo({ name: 'Preset' }).spy;
    const todoSpy = getRepo({ name: 'Todo' }).spy;
    expect(presetSpy.calls[0]).toBe('where(p.userId = :userId)');
    expect(presetSpy.calls).toContainEqual(expect.stringContaining('ILIKE'));
    expect(presetSpy.calls).toContain('take(3)');
    expect(presetSpy.calls).toContain('getMany');
    expect(todoSpy.calls).toHaveLength(0); // unrequested scope never queried
  });

  it('without @tokens searches ALL scopes in parallel and merges newest-first', async () => {
    const { svc, getRepo } = makeDeps();
    const t1 = new Date('2026-01-01T00:00:00Z');
    const t2 = new Date('2026-02-01T00:00:00Z');
    const t3 = new Date('2026-03-01T00:00:00Z');
    getRepo({ name: 'Todo' }).rows = [{ id: 't1', title: 'a', description: 'x', updatedAt: t1 }];
    getRepo({ name: 'Preset' }).rows = [{ id: 'p1', name: 'b', language: 'css', updatedAt: t3 }];
    getRepo({ name: 'Document' }).rows = [{ id: 'd1', name: 'c', description: null, updatedAt: t2 }];

    const res = await svc.search('u1', { q: 'anything', limit: 10 });

    expect(res.scopes).toEqual(['all']);
    expect(res.total).toBe(3);
    expect(res.results.map((h) => h.id)).toEqual(['p1', 'd1', 't1']); // newest-first across scopes
    expect(res.results[0]).toMatchObject({ type: 'preset', title: 'b', subtitle: 'css' });
    // Every scope was actually queried, each ownership-scoped.
    for (const name of ['Todo', 'Preset', 'Document']) {
      expect(getRepo({ name }).spy.calls[0]).toContain('userId');
    }
  });

  it('default limit is 10 and values are clamped to 1..50', async () => {
    const { svc, getRepo } = makeDeps();
    await svc.search('u1', { q: '@todos x' });
    expect(getRepo({ name: 'Todo' }).spy.calls).toContain('take(10)');
    await svc.search('u1', { q: '@todos x', limit: 999 });
    expect(getRepo({ name: 'Todo' }).spy.calls).toContain('take(50)');
  });

  it('scope-only query (empty term) browses recent items of that scope', async () => {
    const { svc, getRepo } = makeDeps();
    await svc.search('u1', { q: '@tools' });
    const spy = getRepo({ name: 'Tool' }).spy;
    expect(spy.calls.filter((c) => c.startsWith('andWhere'))).toHaveLength(0); // no ILIKE filter
    expect(spy.calls).toContain('take(10)');
  });

  it('note hits resolve by fileId and carry a tag-stripped preview', async () => {
    const { svc, getRepo } = makeDeps();
    getRepo({ name: 'Note' }).rawRows = [
      { fileId: 'f-1', fileName: 'meeting.html', preview: 'agenda item one', updatedAt: new Date() },
    ];
    const res = await svc.search('u1', { q: '@notes agenda' });
    expect(res.results[0]).toMatchObject({
      type: 'note',
      id: 'f-1', // GET /notes/:fileId contract
      title: 'meeting.html',
      subtitle: 'agenda item one',
    });
    const spy = getRepo({ name: 'Note' }).spy;
    expect(spy.calls.some((c) => c.includes("content ILIKE"))).toBe(true);
    expect(spy.calls.some((c) => c.includes("f.name ILIKE"))).toBe(true); // file name too
    expect(spy.calls).toContain('getRawMany');
  });

  it('component scope matches code file bodies too (EXISTS subquery)', async () => {
    const { svc, getRepo } = makeDeps();
    await svc.search('u1', { q: '@components align-self' });
    const calls = getRepo({ name: 'Component' }).spy.calls;
    expect(calls.some((c) => c.includes('EXISTS (SELECT 1 FROM component_file'))).toBe(true);
    expect(calls.some((c) => c.includes('c.name ILIKE'))).toBe(true);
  });

  it('duplicate scope tokens collapse to one query', async () => {
    const { svc, getRepo } = makeDeps();
    await svc.search('u1', { q: '@presets @preset a' });
    expect(getRepo({ name: 'Preset' }).spy.calls.filter((c) => c.startsWith('where'))).toHaveLength(1);
  });
});
