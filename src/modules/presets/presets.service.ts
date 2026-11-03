import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Preset } from '../../database/typeorm/entities/preset.entity';
import type { CreatePresetDto } from './dto/create-preset.dto';
import type { QueryPresetsDto } from './dto/query-presets.dto';
import type { UpdatePresetDto } from './dto/update-preset.dto';

/** DI token for the shared TypeORM DataSource (domain tables). */
export const PRESETS_DATA_SOURCE = 'PRESETS_DATA_SOURCE';

export interface PresetPage {
  items: Preset[];
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

const SORT_COLUMNS: Record<NonNullable<QueryPresetsDto['sortBy']>, string> = {
  createdAt: 'p.createdAt',
  name: 'p.name',
};

/**
 * All queries are scoped by `userId`. Ownership miss → 404 (never 403), so a
 * caller cannot probe another user's ids.
 */
@Injectable()
export class PresetsService {
  constructor(@Inject(PRESETS_DATA_SOURCE) private readonly dataSource: DataSource) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  private async repo(): Promise<Repository<Preset>> {
    return (await this.ready()).getRepository(Preset);
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreatePresetDto): Promise<Preset> {
    const repo = await this.repo();
    return repo.save(
      repo.create({
        userId,
        name: dto.name,
        language: dto.language,
        // Stored verbatim — no escaping/trimming of the code payload.
        data: dto.data,
      } as never) as unknown as Preset,
    );
  }

  // ── READ (paginated + search + language filter + sort) ─────────────────────

  async list(userId: string, query: QueryPresetsDto): Promise<PresetPage> {
    // Service-level clamps keep the boundary safe even for direct service use.
    const { page, limit } = clampPagination(query.page, query.limit);
    const repo = await this.repo();

    const qb = repo.createQueryBuilder('p').where('p.userId = :userId', { userId });

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      qb.andWhere("p.name ILIKE :searchPattern ESCAPE '\\'", { searchPattern: pattern });
    }
    if (query.language) {
      qb.andWhere('p.language = :language', { language: query.language });
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder: 'asc' | 'desc' = query.sortOrder ?? (sortBy === 'name' ? 'asc' : 'desc');
    const dir = sortOrder.toUpperCase() as 'ASC' | 'DESC';

    // Count with the SAME filters (cloned before select/order/pagination).
    const countPromise = qb
      .clone()
      .select('COUNT(p.id)', 'cnt')
      .getRawOne<{ cnt: string | number }>();

    qb.orderBy(SORT_COLUMNS[sortBy], dir);
    // Stable tie-breaker when createdAt is NOT the primary column. (TypeORM's
    // orderBys is keyed by expression, so re-adding the primary column with a
    // second direction would silently overwrite its sort.)
    if (sortBy !== 'createdAt') {
      qb.addOrderBy('p.createdAt', 'DESC');
    }

    qb.skip((page - 1) * limit).take(limit);

    const [items, countRow] = await Promise.all([
      qb.getMany(),
      countPromise.then((row) => Number(row?.cnt ?? 0)),
    ]);
    const total = Number(countRow ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return { items, total, page, limit, totalPages };
  }

  async findOne(userId: string, id: string): Promise<Preset> {
    const preset = await (await this.repo()).findOneBy({ id, userId } as never);
    if (!preset) throw new NotFoundException(`Preset ${id} not found`);
    return preset;
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────

  async update(userId: string, id: string, dto: UpdatePresetDto): Promise<Preset> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field to update is required');
    }
    const repo = await this.repo();
    // Ownership in the WHERE clause: another user's id → 0 affected → 404.
    // `now()` keeps updatedAt on the DATABASE clock (client clocks can skew).
    const result = await repo
      .createQueryBuilder()
      .update(Preset)
      .set({
        ...(dto as Record<string, unknown>),
        updatedAt: () => 'now()',
      })
      .where('id = :id AND user_id = :userId', { id, userId })
      .execute();
    if (!result.affected) throw new NotFoundException(`Preset ${id} not found`);

    const preset = await repo.findOneBy({ id, userId } as never);
    if (!preset) throw new NotFoundException(`Preset ${id} not found`);
    return preset;
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────

  async remove(userId: string, id: string): Promise<{ deleted: boolean; id: string }> {
    const repo = await this.repo();
    // Ownership in the DELETE's criteria: another user's id → 0 affected → 404.
    const result = await repo.delete({ id, userId } as never);
    if (!result.affected) throw new NotFoundException(`Preset ${id} not found`);
    return { deleted: true, id };
  }
}
