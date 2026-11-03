import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Tool } from '../../database/typeorm/entities/tool.entity';
import type { CreateToolDto } from './dto/create-tool.dto';
import type { QueryToolsDto } from './dto/query-tools.dto';
import type { UpdateToolDto } from './dto/update-tool.dto';

/** DI token for the shared TypeORM DataSource (domain tables). */
export const TOOL_DATA_SOURCE = 'TOOL_DATA_SOURCE';

export interface ToolPage {
  items: Tool[];
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

const SORT_COLUMNS: Record<NonNullable<QueryToolsDto['sortBy']>, string> = {
  createdAt: 't.createdAt',
  name: 't.name',
};

/**
 * All queries are scoped by `userId`. Ownership miss → 404 (never 403), so a
 * caller cannot probe another user's ids.
 */
@Injectable()
export class ToolsService {
  constructor(@Inject(TOOL_DATA_SOURCE) private readonly dataSource: DataSource) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  private async repo(): Promise<Repository<Tool>> {
    return (await this.ready()).getRepository(Tool);
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateToolDto): Promise<Tool> {
    const repo = await this.repo();
    return repo.save(
      repo.create({
        userId,
        name: dto.name,
        description: dto.description ?? null,
        downloadLink: dto.downloadLink,
      } as never) as unknown as Tool,
    );
  }

  // ── READ (paginated + search + sort) ───────────────────────────────────────

  async list(userId: string, query: QueryToolsDto): Promise<ToolPage> {
    // Service-level clamps keep the boundary safe even for direct service use.
    const { page, limit } = clampPagination(query.page, query.limit);
    const repo = await this.repo();

    const qb = repo.createQueryBuilder('t').where('t.userId = :userId', { userId });

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      qb.andWhere(
        `(t.name ILIKE :searchPattern ESCAPE '\\' OR t.description ILIKE :searchPattern ESCAPE '\\')`,
        { searchPattern: pattern },
      );
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder: 'asc' | 'desc' = query.sortOrder ?? (sortBy === 'name' ? 'asc' : 'desc');
    const dir = sortOrder.toUpperCase() as 'ASC' | 'DESC';

    // Count with the SAME filters (cloned before select/order/pagination).
    const countPromise = qb
      .clone()
      .select('COUNT(t.id)', 'cnt')
      .getRawOne<{ cnt: string | number }>();

    qb.orderBy(SORT_COLUMNS[sortBy], dir);
    qb.addOrderBy('t.createdAt', 'DESC'); // stable tie-breaker (e.g. equal names)

    qb.skip((page - 1) * limit).take(limit);

    const [items, countRow] = await Promise.all([
      qb.getMany(),
      countPromise.then((row) => Number(row?.cnt ?? 0)),
    ]);
    const total = Number(countRow ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return { items, total, page, limit, totalPages };
  }

  async findOne(userId: string, id: string): Promise<Tool> {
    const tool = await (await this.repo()).findOneBy({ id, userId } as never);
    if (!tool) throw new NotFoundException(`Tool ${id} not found`);
    return tool;
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────

  async update(userId: string, id: string, dto: UpdateToolDto): Promise<Tool> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field to update is required');
    }
    const repo = await this.repo();
    // Ownership in the WHERE clause: another user's id → 0 affected → 404.
    // `now()` keeps updatedAt on the DATABASE clock (client clocks can skew).
    const result = await repo
      .createQueryBuilder()
      .update(Tool)
      .set({
        ...(dto as Record<string, unknown>),
        updatedAt: () => 'now()',
      })
      .where('id = :id AND user_id = :userId', { id, userId })
      .execute();
    if (!result.affected) throw new NotFoundException(`Tool ${id} not found`);

    const tool = await repo.findOneBy({ id, userId } as never);
    if (!tool) throw new NotFoundException(`Tool ${id} not found`);
    return tool;
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────

  async remove(userId: string, id: string): Promise<{ deleted: boolean; id: string }> {
    const repo = await this.repo();
    // Ownership in the DELETE's criteria: another user's id → 0 affected → 404.
    const result = await repo.delete({ id, userId } as never);
    if (!result.affected) throw new NotFoundException(`Tool ${id} not found`);
    return { deleted: true, id };
  }
}
