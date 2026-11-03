import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Component } from '../../database/typeorm/entities/component.entity';
import { IdeSnippet } from '../../database/typeorm/entities/ide-snippet.entity';
import { Note } from '../../database/typeorm/entities/note.entity';
import { Preset } from '../../database/typeorm/entities/preset.entity';
import { Todo } from '../../database/typeorm/entities/todo.entity';
import { Tool } from '../../database/typeorm/entities/tool.entity';
import {
  POST_RESOURCE_LABELS,
  POST_RESOURCE_TYPES,
  Post,
  PostResourceType,
} from '../../database/typeorm/entities/post.entity';
import { PostVote } from '../../database/typeorm/entities/post-vote.entity';
import { POSTS_DATA_SOURCE } from './posts.tokens';
import type { CreatePostDto } from './dto/create-post.dto';
import type { QueryPostsDto } from './dto/query-posts.dto';
import type { UpdatePostDto } from './dto/update-post.dto';

/** DI token comes from ./posts.tokens (chat/search style). */

export interface PostAuthor {
  /** BetterAuth user id (same value as post.userId). */
  id: string;
  /** Unique handle — legacy rows may lack it (fallback ''). */
  username: string;
  name: string | null;
  image: string | null;
}

/** Shape returned by every post READ — post + author + votes. */
export interface PostView {
  id: string;
  userId: string;
  resourceType: PostResourceType;
  resourceId: string;
  title: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  author: PostAuthor;
  /** Total upvotes across ALL users. */
  voteCount: number;
  /** Whether the VIEWER has voted — anonymous viewers always see false. */
  hasVoted: boolean;
}

export interface PostPage {
  items: PostView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface VoteResult {
  postId: string;
  hasVoted: boolean;
  voteCount: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const clampPagination = (page?: number, limit?: number): { page: number; limit: number } => {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  return { page: safePage, limit: safeLimit };
};

/** Escape LIKE wildcards in user input so `100%` does not match everything. */
const escapeLike = (input: string): string => input.replace(/([%_\\])/g, '\\$1');

/** First `code` found walking TypeORM's driverError/original/cause chain. */
const pgErrorCode = (error: unknown): string | undefined => {
  let err: unknown = error;
  for (let i = 0; i < 5 && err; i++) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    err =
      (err as { driverError?: unknown }).driverError ??
      (err as { cause?: unknown }).cause ??
      (err as { original?: unknown }).original;
  }
  return undefined;
};

/**
 * The post view needs author identity (BetterAuth `"user"` row — NOT a
 * TypeORM entity, PRD D4), the upvote total and the viewer's own vote. One
 * parameterized raw SELECT answers all three, so reads go through `ds.query`
 * (ChatService raw-SQL style) while writes go through the `post`/`post_vote`
 * repositories.
 */
const VIEW_COLUMNS = [
  'p.id, p.user_id AS "userId", p.resource_type AS "resourceType", p.resource_id AS "resourceId",',
  'p.title, p.description, p.created_at AS "createdAt", p.updated_at AS "updatedAt",',
  'u.username AS "authorUsername", u.name AS "authorName", u.image AS "authorImage",',
  '(SELECT COUNT(*)::int FROM post_vote v WHERE v.post_id = p.id) AS "voteCount"',
].join('\n');

const FROM_JOIN = 'FROM post p\nLEFT JOIN "user" u ON u.id = p.user_id';

/** Raw column shape of one post-view row. */
interface PostRow {
  id: string;
  userId: string;
  resourceType: PostResourceType;
  resourceId: string;
  title: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  authorUsername: string | null;
  authorName: string | null;
  authorImage: string | null;
  voteCount: number;
  hasVoted: boolean;
}

const toView = (row: PostRow): PostView => ({
  id: row.id,
  userId: row.userId,
  resourceType: row.resourceType,
  resourceId: row.resourceId,
  title: row.title,
  description: row.description,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  author: {
    id: row.userId,
    username: row.authorUsername ?? '',
    name: row.authorName,
    image: row.authorImage,
  },
  voteCount: Number(row.voteCount ?? 0),
  hasVoted: row.hasVoted === true,
});

/**
 * Public post sharing: anyone can READ (feed/detail, anonymous included);
 * publishing/editing/un-publishing is owner-only; one upvote per user per
 * post (composite PK + or-ignore insert). List queries scope who they serve —
 * `mine` pins author_id to the caller; ownership checks live in WHERE
 * clauses, so foreign rows 404 instead of leaking existence.
 */
@Injectable()
export class PostsService {
  constructor(@Inject(POSTS_DATA_SOURCE) private readonly dataSource: DataSource) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  private async repo(): Promise<Repository<Post>> {
    return (await this.ready()).getRepository(Post);
  }

  // ── READ (paginated + search + filter + sort + author + votes) ─────────────

  /** Public feed — no scoping filters; anonymous viewers welcome. */
  async feed(query: QueryPostsDto, viewerId: string | null): Promise<PostPage> {
    const { page, limit } = clampPagination(query.page, query.limit);
    return this.page(
      { resourceType: query.resourceType, search: query.search },
      { sortBy: query.sortBy ?? 'createdAt', sortOrder: query.sortOrder ?? 'desc' },
      { page, limit },
      viewerId,
    );
  }

  /** Own posts (POSTS.me) — author_id pinned to the caller. */
  async mine(userId: string, query: QueryPostsDto): Promise<PostPage> {
    const { page, limit } = clampPagination(query.page, query.limit);
    return this.page(
      { authorId: userId, resourceType: query.resourceType, search: query.search },
      { sortBy: query.sortBy ?? 'createdAt', sortOrder: query.sortOrder ?? 'desc' },
      { page, limit },
      userId,
    );
  }

  /** Single post — public; `viewerId` drives hasVoted only. */
  async findOne(id: string, viewerId: string | null): Promise<PostView> {
    const ds = await this.ready();
    const params: unknown[] = [id];
    const hasVoted = this.hasVotedSelect(params, viewerId);
    const sql = [
      'SELECT',
      `  ${VIEW_COLUMNS},`,
      `  ${hasVoted}`,
      FROM_JOIN,
      'WHERE p.id = $1',
      'LIMIT 1',
    ].join('\n');
    const rows = (await ds.query(sql, params)) as PostRow[];
    if (!rows.length) throw new NotFoundException(`Post ${id} not found`);
    return toView(rows[0]);
  }

  /**
   * Shared page/paging/mine implementation. Conditions are collected FIRST so
   * the COUNT keeps exactly the same filters (its param list is the slice
   * built before viewer/limit/offset params join in).
   */
  private async page(
    where: { authorId?: string; resourceType?: PostResourceType; search?: string },
    sort: { sortBy: NonNullable<QueryPostsDto['sortBy']>; sortOrder: NonNullable<QueryPostsDto['sortOrder']> },
    pagination: { page: number; limit: number },
    viewerId: string | null,
  ): Promise<PostPage> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (where.authorId) {
      params.push(where.authorId);
      conditions.push(`p.user_id = $${params.length}`);
    }
    if (where.resourceType) {
      params.push(where.resourceType);
      conditions.push(`p.resource_type = $${params.length}`);
    }
    if (where.search) {
      const pattern = `%${escapeLike(where.search)}%`;
      params.push(pattern, pattern);
      conditions.push(
        `(p.title ILIKE $${params.length - 1} ESCAPE '\\' OR p.description ILIKE $${params.length} ESCAPE '\\')`,
      );
    }
    const whereSql = conditions.length ? `WHERE ${conditions.join('\n  AND ')}` : '';
    const condParams = [...params];
    const hasVoted = this.hasVotedSelect(params, viewerId);

    const dir = sort.sortOrder.toUpperCase() as 'ASC' | 'DESC';
    const sortExpr =
      sort.sortBy === 'votes'
        ? `"voteCount" ${dir}, p.created_at DESC, p.id ASC` // vote leader first, stable ties
        : sort.sortBy === 'updatedAt'
          ? `p.updated_at ${dir}, p.created_at DESC, p.id ASC`
          : `p.created_at ${dir}, p.id ASC`;

    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    params.push(pagination.limit, (pagination.page - 1) * pagination.limit);

    const ds = await this.ready();
    const [rows, countRows] = (await Promise.all([
      ds.query(
        [
          'SELECT',
          `  ${VIEW_COLUMNS},`,
          `  ${hasVoted}`,
          FROM_JOIN,
          whereSql,
          `ORDER BY ${sortExpr}`,
          `LIMIT $${limitParam} OFFSET $${offsetParam}`,
        ]
          .filter((line) => line.length > 0)
          .join('\n'),
        params,
      ),
      // COUNT with the SAME filters (viewer/limit/offset params excluded).
      ds.query(
        `SELECT COUNT(*)::int AS "cnt" FROM post p${whereSql ? `\n${whereSql}` : ''}`,
        condParams,
      ),
    ])) as [PostRow[], Array<{ cnt: number | string }>];

    const total = Number(countRows[0]?.cnt ?? 0);
    return {
      items: rows.map(toView),
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
    };
  }

  /** `EXISTS` for signed-in viewers; anonymous viewers get a constant false. */
  private hasVotedSelect(params: unknown[], viewerId: string | null): string {
    if (!viewerId) return 'false AS "hasVoted"';
    params.push(viewerId);
    return `EXISTS (SELECT 1 FROM post_vote hv WHERE hv.post_id = p.id AND hv.user_id = $${params.length}) AS "hasVoted"`;
  }

  // ── CREATE (publish — resource owner check + one post per resource) ────────

  async create(userId: string, dto: CreatePostDto): Promise<PostView> {
    // The post points AT the caller's existing resource — never copy data.
    // Foreign/missing resources must not leak either (404, not 403).
    await this.assertResourceOwned(userId, dto.resourceType, dto.resourceId);

    const repo = await this.repo();
    let saved: Post;
    try {
      saved = (await repo.save(
        repo.create({
          userId,
          resourceType: dto.resourceType,
          resourceId: dto.resourceId,
          title: dto.title,
          description: dto.description ?? null,
        } as never) as unknown as Post,
      )) as Post;
    } catch (error) {
      // uq_post_resource → the same resource is already published.
      if (pgErrorCode(error) === '23505') {
        throw new ConflictException(
          `This ${POST_RESOURCE_LABELS[dto.resourceType]} is already published as a post`,
        );
      }
      throw error;
    }
    return this.findOne(saved.id, userId);
  }

  /** Ownership proof per resource kind (notes are addressed by their file id). */
  private async assertResourceOwned(
    userId: string,
    resourceType: PostResourceType,
    resourceId: string,
  ): Promise<void> {
    const ds = await this.ready();
    const findBy: Record<PostResourceType, () => Promise<unknown>> = {
      todo: () => ds.getRepository(Todo).findOneBy({ id: resourceId, userId } as never),
      note: () => ds.getRepository(Note).findOneBy({ fileId: resourceId, userId } as never),
      component: () => ds.getRepository(Component).findOneBy({ id: resourceId, userId } as never),
      preset: () => ds.getRepository(Preset).findOneBy({ id: resourceId, userId } as never),
      tool: () => ds.getRepository(Tool).findOneBy({ id: resourceId, userId } as never),
      snippet: () => ds.getRepository(IdeSnippet).findOneBy({ id: resourceId, userId } as never),
    };
    const owned = await findBy[resourceType]();
    if (!owned) {
      throw new NotFoundException(
        `${POST_RESOURCE_LABELS[resourceType]} ${resourceId} not found`,
      );
    }
  }

  // ── UPDATE (owner-scoped WHERE; post metadata only) ────────────────────────

  async update(userId: string, id: string, dto: UpdatePostDto): Promise<PostView> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field to update is required');
    }
    const repo = await this.repo();
    // Ownership in the WHERE clause: another user's id → 0 affected → 404.
    // `now()` keeps updatedAt on the DATABASE clock (client clocks can skew).
    const result = await repo
      .createQueryBuilder()
      .update(Post)
      .set({
        ...(dto as Record<string, unknown>),
        updatedAt: () => 'now()',
      })
      .where('id = :id AND user_id = :userId', { id, userId })
      .execute();
    if (!result.affected) throw new NotFoundException(`Post ${id} not found`);
    return this.findOne(id, userId);
  }

  // ── DELETE (un-publish — votes cascade via fk_post_vote_post) ──────────────

  async remove(userId: string, id: string): Promise<{ deleted: boolean; id: string }> {
    const repo = await this.repo();
    // Scoped delete: votes cascade with the post, everything stays per-owner.
    const result = await repo.delete({ id, userId } as never);
    if (!result.affected) throw new NotFoundException(`Post ${id} not found`);
    return { deleted: true, id };
  }

  // ── VOTES (one per user per post, race-safe) ───────────────────────────────

  /** Upvote. The composite PK + or-ignore INSERT makes duplicates no-ops → 409. */
  async addVote(userId: string, id: string): Promise<VoteResult> {
    const ds = await this.ready();
    const post = await ds.getRepository(Post).findOneBy({ id } as never);
    if (!post) throw new NotFoundException(`Post ${id} not found`);

    const result = await ds
      .getRepository(PostVote)
      .createQueryBuilder()
      .insert()
      .into(PostVote)
      .values({ postId: id, userId } as never)
      .orIgnore() // pk_post_vote (post_id, user_id) → silent skip on dup
      .returning('post_id')
      .execute();
    // RETURNING yields rows only for actual inserts — no row ⇒ already voted.
    const inserted = (result.raw as Array<{ post_id?: string }> | undefined) ?? [];
    if (!inserted.length) {
      throw new ConflictException('You have already voted for this post');
    }
    return { postId: id, hasVoted: true, voteCount: await this.countVotes(id) };
  }

  /** Remove the caller's own vote (un-vote); a never-cast vote → 404. */
  async removeVote(userId: string, id: string): Promise<VoteResult> {
    const ds = await this.ready();
    const post = await ds.getRepository(Post).findOneBy({ id } as never);
    if (!post) throw new NotFoundException(`Post ${id} not found`);

    const result = await ds
      .getRepository(PostVote)
      .createQueryBuilder()
      .delete()
      .from(PostVote)
      .where('post_id = :postId AND user_id = :userId', { postId: id, userId })
      .execute();
    if (!result.affected) {
      throw new NotFoundException('Vote not found — you have not voted for this post');
    }
    return { postId: id, hasVoted: false, voteCount: await this.countVotes(id) };
  }

  private async countVotes(postId: string): Promise<number> {
    const ds = await this.ready();
    const rows = (await ds.query(
      `SELECT COUNT(*)::int AS "cnt" FROM post_vote WHERE post_id = $1`,
      [postId],
    )) as Array<{ cnt: number | string }>;
    return Number(rows[0]?.cnt ?? 0);
  }
}

export { POST_RESOURCE_TYPES };
