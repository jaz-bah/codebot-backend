import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Artboard } from '../../database/typeorm/entities/artboard.entity';
import type { CreateArtboardDto } from './dto/create-artboard.dto';
import type { QueryArtboardsDto } from './dto/query-artboards.dto';
import type { UpdateArtboardDto } from './dto/update-artboard.dto';

/** DI token for the shared TypeORM DataSource (domain tables). */
export const ARTBOARD_DATA_SOURCE = 'ARTBOARD_DATA_SOURCE';

export interface ArtboardPage {
  items: Artboard[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
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

const SORT_COLUMNS: Record<NonNullable<QueryArtboardsDto['sortBy']>, string> = {
  createdAt: 't.createdAt',
  title: 't.title',
};

/**
 * All queries are scoped by `userId` (ownership enforced in the WHERE clause —
 * another user's id is indistinguishable from a missing one → 404). Artboard
 * content is written verbatim; nothing here trims, parses or escapes it.
 */
@Injectable()
export class ArtboardsService {
  constructor(@Inject(ARTBOARD_DATA_SOURCE) private readonly dataSource: DataSource) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  private async repo(): Promise<Repository<Artboard>> {
    return (await this.ready()).getRepository(Artboard);
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateArtboardDto): Promise<Artboard> {
    const repo = await this.repo();
    return repo.save({
      userId,
      title: dto.title,
      content: dto.content ?? '',
    } as never) as unknown as Artboard;
  }

  // ── READ (paginated + search + sort) ───────────────────────────────────────

  async list(userId: string, query: QueryArtboardsDto): Promise<ArtboardPage> {
    // Service-level clamps keep the boundary safe even for direct service use.
    const { page, limit } = clampPagination(query.page, query.limit);
    const repo = await this.repo();

    const qb = repo.createQueryBuilder('t').where('t.userId = :userId', { userId });

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      qb.andWhere(
        "(t.title ILIKE :searchPattern ESCAPE '\\' OR t.content ILIKE :searchPattern ESCAPE '\\')",
        { searchPattern: pattern },
      );
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder: 'asc' | 'desc' = query.sortOrder ?? 'desc';
    const dir = sortOrder.toUpperCase() as 'ASC' | 'DESC';

    // Count with the SAME filters (cloned before select/order/pagination).
    const countPromise = qb
      .clone()
      .select('COUNT(t.id)', 'cnt')
      .getRawOne<{ cnt: string | number }>();

    qb.orderBy(SORT_COLUMNS[sortBy], dir);
    qb.addOrderBy('t.createdAt', 'DESC'); // stable tie-breaker

    qb.skip((page - 1) * limit).take(limit);

    const [items, countRow] = await Promise.all([
      qb.getMany(),
      countPromise.then((row) => Number(row?.cnt ?? 0)),
    ]);
    const total = Number(countRow ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return { items, total, page, limit, totalPages };
  }

  async findOne(userId: string, id: string): Promise<Artboard> {
    const artboard = await (await this.repo()).findOneBy({ id, userId } as never);
    if (!artboard) throw new NotFoundException(`Artboard ${id} not found`);
    return artboard;
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────

  async update(userId: string, id: string, dto: UpdateArtboardDto): Promise<Artboard> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field to update is required');
    }
    const repo = await this.repo();
    // Ownership in the WHERE clause: another user's id → 0 affected → 404.
    // `now()` keeps updatedAt on the DATABASE clock (client clocks can skew).
    const result = await repo
      .createQueryBuilder()
      .update(Artboard)
      .set({
        ...(dto as Record<string, unknown>),
        updatedAt: () => 'now()',
      })
      .where('id = :id AND user_id = :userId', { id, userId })
      .execute();
    if (!result.affected) throw new NotFoundException(`Artboard ${id} not found`);

    const artboard = await repo.findOneBy({ id, userId } as never);
    if (!artboard) throw new NotFoundException(`Artboard ${id} not found`);
    return artboard;
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────

  async remove(userId: string, id: string): Promise<{ deleted: boolean; id: string }> {
    const repo = await this.repo();
    const result = await repo.delete({ id, userId } as never);
    if (!result.affected) throw new NotFoundException(`Artboard ${id} not found`);
    return { deleted: true, id };
  }
}
