import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Expert } from '../../database/typeorm/entities/expert.entity';
import type { CreateExpertDto } from './dto/create-expert.dto';
import type { QueryExpertsDto } from './dto/query-experts.dto';
import type { UpdateExpertDto } from './dto/update-expert.dto';

/** DI token for the shared TypeORM DataSource (domain tables). */
export const EXPERTS_DATA_SOURCE = 'EXPERTS_DATA_SOURCE';

export interface ExpertPage {
  items: Expert[];
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

const SORT_COLUMNS: Record<NonNullable<QueryExpertsDto['sortBy']>, string> = {
  createdAt: 'e.createdAt',
  title: 'e.title',
};

/**
 * All queries are scoped by `userId`. Ownership miss → 404 (never 403), so a
 * caller cannot probe another user's ids.
 */
@Injectable()
export class ExpertsService {
  constructor(@Inject(EXPERTS_DATA_SOURCE) private readonly dataSource: DataSource) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  private async repo(): Promise<Repository<Expert>> {
    return (await this.ready()).getRepository(Expert);
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateExpertDto): Promise<Expert> {
    const repo = await this.repo();
    return repo.save(
      repo.create({
        userId,
        title: dto.title,
        description: dto.description ?? null,
      } as never) as unknown as Expert,
    );
  }

  // ── READ (paginated + search + sort) ───────────────────────────────────────

  async list(userId: string, query: QueryExpertsDto): Promise<ExpertPage> {
    // Service-level clamps keep the boundary safe even for direct service use.
    const { page, limit } = clampPagination(query.page, query.limit);
    const repo = await this.repo();

    const qb = repo.createQueryBuilder('e').where('e.userId = :userId', { userId });

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      qb.andWhere(
        "(e.title ILIKE :searchPattern ESCAPE '\\' OR e.description ILIKE :searchPattern ESCAPE '\\')",
        { searchPattern: pattern },
      );
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder: 'asc' | 'desc' = query.sortOrder ?? (sortBy === 'title' ? 'asc' : 'desc');
    const dir = sortOrder.toUpperCase() as 'ASC' | 'DESC';

    // Count with the SAME filters (cloned before select/order/pagination).
    const countPromise = qb
      .clone()
      .select('COUNT(e.id)', 'cnt')
      .getRawOne<{ cnt: string | number }>();

    qb.orderBy(SORT_COLUMNS[sortBy], dir);
    qb.addOrderBy('e.createdAt', 'DESC'); // stable tie-breaker (e.g. equal titles)

    qb.skip((page - 1) * limit).take(limit);

    const [items, countRow] = await Promise.all([
      qb.getMany(),
      countPromise.then((row) => Number(row?.cnt ?? 0)),
    ]);
    const total = Number(countRow ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return { items, total, page, limit, totalPages };
  }

  async findOne(userId: string, id: string): Promise<Expert> {
    const expert = await (await this.repo()).findOneBy({ id, userId } as never);
    if (!expert) throw new NotFoundException(`Expert ${id} not found`);
    return expert;
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────

  async update(userId: string, id: string, dto: UpdateExpertDto): Promise<Expert> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field to update is required');
    }
    const repo = await this.repo();
    // Ownership in the WHERE clause: another user's id → 0 affected → 404.
    // `now()` keeps updatedAt on the DATABASE clock (client clocks can skew).
    const result = await repo
      .createQueryBuilder()
      .update(Expert)
      .set({
        ...(dto as Record<string, unknown>),
        updatedAt: () => 'now()',
      })
      .where('id = :id AND user_id = :userId', { id, userId })
      .execute();
    if (!result.affected) throw new NotFoundException(`Expert ${id} not found`);

    const expert = await repo.findOneBy({ id, userId } as never);
    if (!expert) throw new NotFoundException(`Expert ${id} not found`);
    return expert;
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────

  async remove(userId: string, id: string): Promise<{ deleted: boolean; id: string }> {
    const repo = await this.repo();
    // Ownership in the DELETE's criteria: another user's id → 0 affected → 404.
    const result = await repo.delete({ id, userId } as never);
    if (!result.affected) throw new NotFoundException(`Expert ${id} not found`);
    return { deleted: true, id };
  }
}
