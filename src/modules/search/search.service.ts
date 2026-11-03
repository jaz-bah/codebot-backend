import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { WorkspaceFile } from '../../database/typeorm/entities/workspace-file.entity';
import { Note } from '../../database/typeorm/entities/note.entity';
import { Todo } from '../../database/typeorm/entities/todo.entity';
import { Preset } from '../../database/typeorm/entities/preset.entity';
import { Expert } from '../../database/typeorm/entities/expert.entity';
import { Tool } from '../../database/typeorm/entities/tool.entity';
import { IdeSnippet } from '../../database/typeorm/entities/ide-snippet.entity';
import { Document } from '../../database/typeorm/entities/document.entity';
import { Component } from '../../database/typeorm/entities/component.entity';
import { SEARCH_DATA_SOURCE } from './search.tokens';
import type { SearchQueryDto } from './dto/search.dto';
import { SEARCH_MAX_LIMIT } from './dto/search.dto';

/** One hit ready for a unified result list. */
export interface SearchHit {
  /** Singular domain label: todo | note | file | document | component | preset | expert | tool | snippet. */
  type: string;
  /** Resolver id — whatever the type's own API uses (note hits carry the fileId). */
  id: string;
  title: string;
  subtitle: string | null;
  updatedAt: Date | null;
}

export interface SearchResponse {
  /** Raw query the user sent (echoed for transparency). */
  query: string;
  /** Canonical scopes that were searched ('*' when none were specified). */
  scopes: string[] | ['all'];
  /** Effective per-scope hit cap. */
  limit: number;
  /** Total number of hits (≤ scopes × limit). */
  total: number;
  /** Merged, newest-first across scopes. */
  results: SearchHit[];
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = SEARCH_MAX_LIMIT;

/** Escape LIKE wildcards so `100%` is a literal run of characters. */
const escapeLike = (input: string): string => input.replace(/([%_\\])/g, '\\$1');

/** Regular text left after removing the @scopes tokens. */
const collapseWhitespace = (input: string): string => input.replace(/\s+/g, ' ').trim();

// ── scope registry ──────────────────────────────────────────────────────────
// Singular names for hit.type; plural/aliases accepted in the query.
// Every scope query is scoped by user_id and CAPPED at `limit` — search is
// a portal over recent matches, not an export of half the library.

type RunScope = (
  repo: Repository<never>,
  userId: string,
  term: string | null,
  limit: number,
) => Promise<SearchHit[]>;

/** WRAPPED `… ILIKE :p ESCAPE '\'` fragment builder (like every module). */
const ilike = (expr: string): string => `${expr} ILIKE :p ESCAPE '\\'`;

const SCOPES: Record<string, { type: string; run: RunScope }> = {
  todos: {
    type: 'todo',
    run: async (repo, userId, term, limit) => {
      const qb = repo
        .createQueryBuilder('t')
        .where('t.userId = :userId', { userId })
        .orderBy('t.updatedAt', 'DESC')
        .take(limit);
      if (term) {
        qb.andWhere(`(${ilike('t.title')} OR ${ilike('t.description')})`, {
          p: `%${escapeLike(term)}%`,
        });
      }
      return (await qb.getMany() as unknown as Todo[]).map((t) => ({
        type: 'todo',
        id: t.id,
        title: t.title,
        subtitle: t.description,
        updatedAt: t.updatedAt,
      }));
    },
  },
  notes: {
    type: 'note',
    run: async (repo, userId, term, limit) => {
      const qb = (repo as Repository<Note>)
        .createQueryBuilder('n')
        .where('n.userId = :userId', { userId })
        .leftJoin(WorkspaceFile, 'f', 'f.id = n.fileId')
        .select('n.file_id', 'fileId')
        .addSelect('f.name', 'fileName')
        .addSelect('n.updated_at', 'updatedAt')
        // Tag-stripped, whitespace-collapsed preview — same recipe as /notes.
        .addSelect("left(btrim(regexp_replace(n.content, '<[^>]*>', ' ', 'g')), 200)", 'preview')
        .orderBy('n.updated_at', 'DESC')
        .take(limit);
      if (term) {
        qb.andWhere(`(${ilike('n.content')} OR ${ilike('f.name')})`, {
          p: `%${escapeLike(term)}%`,
        });
      }
      const rows = await qb.getRawMany<{ fileId: string; fileName: string; preview: string; updatedAt: Date }>();
      return rows.map((r) => ({
        type: 'note',
        id: r.fileId, // the note API resolves notes BY fileId (GET /notes/:fileId)
        title: r.fileName,
        subtitle: r.preview ?? '',
        updatedAt: r.updatedAt,
      }));
    },
  },
  files: {
    type: 'file',
    run: async (repo, userId, term, limit) => {
      const qb = repo
        .createQueryBuilder('f')
        .where('f.userId = :userId', { userId })
        .orderBy('f.updatedAt', 'DESC')
        .take(limit);
      if (term) {
        qb.andWhere(ilike('f.name'), { p: `%${escapeLike(term)}%` });
      }
      return (await qb.getMany() as unknown as WorkspaceFile[]).map((f) => ({
        type: 'file',
        id: f.id,
        title: f.name,
        subtitle: f.type, // 'folder' | 'file' — hits include folders too
        updatedAt: f.updatedAt,
      }));
    },
  },
  documents: {
    type: 'document',
    run: async (repo, userId, term, limit) => {
      const qb = repo
        .createQueryBuilder('d')
        .where('d.userId = :userId', { userId })
        .orderBy('d.updatedAt', 'DESC')
        .take(limit);
      if (term) {
        qb.andWhere(`(${ilike('d.name')} OR ${ilike('d.description')})`, {
          p: `%${escapeLike(term)}%`,
        });
      }
      return (await qb.getMany() as unknown as Document[]).map((d) => ({
        type: 'document',
        id: d.id,
        title: d.name,
        subtitle: d.description,
        updatedAt: d.updatedAt,
      }));
    },
  },
  components: {
    type: 'component',
    run: async (repo, userId, term, limit) => {
      const qb = repo
        .createQueryBuilder('c')
        .where('c.userId = :userId', { userId })
        .orderBy('c.updatedAt', 'DESC')
        .take(limit);
      if (term) {
        // Name OR any of its code files' bodies — code-level search for free.
        qb.andWhere(
          `(${ilike('c.name')} OR EXISTS (SELECT 1 FROM component_file cf WHERE cf.component_id = c.id AND cf.user_id = :userId AND ${ilike('cf.code')}))`,
          { p: `%${escapeLike(term)}%`, userId },
        );
      }
      return (await qb.getMany() as unknown as Component[]).map((c) => ({
        type: 'component',
        id: c.id,
        title: c.name,
        subtitle: c.preview,
        updatedAt: c.updatedAt,
      }));
    },
  },
  presets: {
    type: 'preset',
    run: async (repo, userId, term, limit) => {
      const qb = repo
        .createQueryBuilder('p')
        .where('p.userId = :userId', { userId })
        .orderBy('p.updatedAt', 'DESC')
        .take(limit);
      if (term) {
        qb.andWhere(`(${ilike('p.name')} OR ${ilike('p.data')})`, {
          p: `%${escapeLike(term)}%`,
        });
      }
      return (await qb.getMany() as unknown as Preset[]).map((p) => ({
        type: 'preset',
        id: p.id,
        title: p.name,
        subtitle: p.language,
        updatedAt: p.updatedAt,
      }));
    },
  },
  experts: {
    type: 'expert',
    run: async (repo, userId, term, limit) => {
      const qb = repo
        .createQueryBuilder('e')
        .where('e.userId = :userId', { userId })
        .orderBy('e.updatedAt', 'DESC')
        .take(limit);
      if (term) {
        qb.andWhere(`(${ilike('e.title')} OR ${ilike('e.description')})`, {
          p: `%${escapeLike(term)}%`,
        });
      }
      return (await qb.getMany() as unknown as Expert[]).map((e) => ({
        type: 'expert',
        id: e.id,
        title: e.title,
        subtitle: e.description,
        updatedAt: e.updatedAt,
      }));
    },
  },
  tools: {
    type: 'tool',
    run: async (repo, userId, term, limit) => {
      const qb = repo
        .createQueryBuilder('t')
        .where('t.userId = :userId', { userId })
        .orderBy('t.updatedAt', 'DESC')
        .take(limit);
      if (term) {
        qb.andWhere(`(${ilike('t.name')} OR ${ilike('t.description')})`, {
          p: `%${escapeLike(term)}%`,
        });
      }
      return (await qb.getMany() as unknown as Tool[]).map((t) => ({
        type: 'tool',
        id: t.id,
        title: t.name,
        subtitle: t.description,
        updatedAt: t.updatedAt,
      }));
    },
  },
  snippets: {
    type: 'snippet',
    run: async (repo, userId, term, limit) => {
      const qb = repo
        .createQueryBuilder('s')
        .where('s.userId = :userId', { userId })
        .orderBy('s.updatedAt', 'DESC')
        .take(limit);
      if (term) {
        qb.andWhere(`(${ilike('s.language')} OR ${ilike('s.data')})`, {
          p: `%${escapeLike(term)}%`,
        });
      }
      return (await qb.getMany() as unknown as IdeSnippet[]).map((s) => ({
        type: 'snippet',
        id: s.id,
        title: `IDE snippet (${s.language})`,
        subtitle: s.data.slice(0, 80),
        updatedAt: s.updatedAt,
      }));
    },
  },
};

/** Every accepted @token → its canonical scope key. */
export const ALIASES: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(SCOPES).flatMap(([scope, def]) => [
      [scope, scope],
      [def.type, scope], // 'todo' → 'todos', 'preset' → 'presets', …
    ]),
  ),
  'ide-snippet': 'snippets',
  'ide-snippets': 'snippets',
  snippet: 'snippets',
};

const SCOPE_TOKEN_RE = /(?:^|\s)@([a-zA-Z0-9_-]*)/g;

/**
 * Unified scoped search across every user-owned domain table. One endpoint —
 * `GET /search?q=@presets name` — no joins between domains; all scope
 * queries run in PARALLEL, each `user_id`-scoped and capped at `limit`,
 * merged newest-first.
 */
@Injectable()
export class SearchService {
  constructor(@Inject(SEARCH_DATA_SOURCE) private readonly dataSource: DataSource) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  /** Parse `@tokens` + residual search text. Unknown tokens → 400. */
  public parse(raw: string): { scopes: string[] | null; term: string | null } {
    const scopeKeys: string[] = [];
    SCOPE_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SCOPE_TOKEN_RE.exec(raw)) !== null) {
      const rawToken = match[1];
      if (rawToken === '') continue; // a bare '@' is plain text, not a token
      const canonical = ALIASES[rawToken.toLowerCase()];
      if (!canonical) {
        throw new BadRequestException(
          `Unknown search scope "@${rawToken}" — supported: ${Object.keys(SCOPES).join(', ')}`,
        );
      }
      if (!scopeKeys.includes(canonical)) scopeKeys.push(canonical);
    }
    const term = collapseWhitespace(raw.replace(/(?:^|\s)@[a-zA-Z0-9_-]*/g, ' '));
    return { scopes: scopeKeys.length > 0 ? scopeKeys : null, term: term.length > 0 ? term : null };
  }

  async search(userId: string, dto: SearchQueryDto): Promise<SearchResponse> {
    const { scopes: requested, term } = this.parse(dto.q);
    if (!requested && !term) {
      throw new BadRequestException(
        'search query is required — text, a scope token (@presets, @todos, …), or both',
      );
    }
    const limit = Math.min(Math.max(Number(dto.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const ds = await this.ready();

    // Default: every scope (no @tokens). Explicit: exactly the requested ones.
    const selected = requested ?? Object.keys(SCOPES);

    const runs = await Promise.all(
      selected.map(async (scope) => {
        // ds.getRepository is untyped across 9 different entities — the scope
        // runners adopt Repository<never> (house `as never` cast style).
        const repo = ds.getRepository(
          ({
            todos: Todo,
            notes: Note,
            files: WorkspaceFile,
            documents: Document,
            components: Component,
            presets: Preset,
            experts: Expert,
            tools: Tool,
            snippets: IdeSnippet,
          }[scope] as unknown) as never,
        ) as unknown as Repository<never>;
        const hits = await SCOPES[scope].run(repo, userId, term, limit);
        return hits;
      }),
    );

    const results = runs
      .flat()
      .sort(
        (a, b) =>
          (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0), // newest first across scopes
      );

    return {
      query: dto.q,
      scopes: requested ? (selected as string[]) : (['all'] as unknown as string[]),
      limit,
      total: results.length,
      results,
    };
  }
}
