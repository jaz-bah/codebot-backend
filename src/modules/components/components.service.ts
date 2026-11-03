import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Component, ComponentWithFiles } from '../../database/typeorm/entities/component.entity';
import { ComponentFile } from '../../database/typeorm/entities/component-file.entity';
import { COMPONENTS_DATA_SOURCE } from './components.tokens';
import type { CreateComponentDto } from './dto/create-component.dto';
import type { QueryComponentsDto } from './dto/query-components.dto';
import type { UpdateComponentDto } from './dto/update-component.dto';

export interface ComponentPage {
  items: ComponentWithFiles[];
  /** Total matching components (files array on each is eager-attached). */
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

const SORT_COLUMNS: Record<NonNullable<QueryComponentsDto['sortBy']>, string> = {
  createdAt: 'c.createdAt',
  updatedAt: 'c.updatedAt',
  name: 'c.name',
};

/**
 * All queries are scoped by `userId`. Create and update run inside ONE
 * database transaction so a component row can never outlive its file set
 * (and a rename can never be torn apart from a file replacement).
 *
 * Read queries stay FLAT for performance: a component page is fetched from
 * `component`, then the files for exactly those page ids in one extra
 * batched query — no N+1, no join fan-out breaking pagination.
 */
@Injectable()
export class ComponentsService {
  constructor(@Inject(COMPONENTS_DATA_SOURCE) private readonly dataSource: DataSource) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  private async repo(): Promise<Repository<Component>> {
    return (await this.ready()).getRepository(Component);
  }

  private async fileRepo(): Promise<Repository<ComponentFile>> {
    return (await this.ready()).getRepository(ComponentFile);
  }

  // ── CREATE (transactional: component + entire file set) ────────────────────

  async create(userId: string, dto: CreateComponentDto): Promise<ComponentWithFiles> {
    const ds = await this.ready();
    return ds.transaction<ComponentWithFiles>(async (em) => {
      const components = em.getRepository(Component);
      const component = await components.save(
        components.create({
          userId,
          name: dto.name,
          preview: dto.preview,
        } as never) as unknown as Component,
      );
      const files = await this.insertFiles(em, userId, component.id, dto.files);
      return { ...component, files };
    });
  }

  // ── READ (paginated + search + language filter + sort, files attached) ─────

  async list(userId: string, query: QueryComponentsDto): Promise<ComponentPage> {
    const { page, limit } = clampPagination(query.page, query.limit);
    const repo = await this.repo();

    const qb = repo.createQueryBuilder('c').where('c.userId = :userId', { userId });

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      qb.andWhere("c.name ILIKE :searchPattern ESCAPE '\\'", { searchPattern: pattern });
    }
    if (query.language) {
      // EXISTS keeps component fan-out at 1 row — pagination counts stay exact.
      qb.andWhere(
        'EXISTS (SELECT 1 FROM component_file cf WHERE cf.component_id = c.id AND cf.user_id = :userId AND cf.language = :language)',
        { userId, language: query.language },
      );
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder: 'asc' | 'desc' =
      query.sortOrder ?? (sortBy === 'name' ? 'asc' : 'desc');
    const dir = sortOrder.toUpperCase() as 'ASC' | 'DESC';

    // Count with the SAME filters (cloned before select/order/pagination).
    const countPromise = qb
      .clone()
      .select('COUNT(c.id)', 'cnt')
      .getRawOne<{ cnt: string | number }>();

    qb.orderBy(SORT_COLUMNS[sortBy], dir);
    qb.addOrderBy('c.createdAt', 'DESC'); // stable tie-breaker
    qb.skip((page - 1) * limit).take(limit);

    const [items, countRow] = await Promise.all([
      qb.getMany(),
      countPromise.then((row) => Number(row?.cnt ?? 0)),
    ]);

    const files = await this.loadFiles(userId, items.map((i) => i.id));
    const byComponent = new Map<string, ComponentFile[]>();
    for (const file of files) {
      const list = byComponent.get(file.componentId) ?? [];
      list.push(file);
      byComponent.set(file.componentId, list);
    }

    const total = Number(countRow ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      items: items.map((i) => ({ ...i, files: byComponent.get(i.id) ?? [] })),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findOne(userId: string, id: string): Promise<ComponentWithFiles> {
    const repo = await this.repo();
    // Ownership in the lookup: another user's id → 404.
    const component = await repo.findOneBy({ id, userId } as never);
    if (!component) throw new NotFoundException(`Component ${id} not found`);
    const files = await this.loadFiles(userId, [id]);
    return { ...component, files };
  }

  // ── UPDATE (transactional: metadata patch and/or full file-set replace) ────

  async update(userId: string, id: string, dto: UpdateComponentDto): Promise<ComponentWithFiles> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field to update is required');
    }
    const ds = await this.ready();
    return ds.transaction<ComponentWithFiles>(async (em) => {
      const components = em.getRepository(Component);
      const component = await components.findOneBy({ id, userId } as never);
      if (!component) throw new NotFoundException(`Component ${id} not found`);

      const patch: Record<string, unknown> = {};
      if (dto.name !== undefined) patch.name = dto.name; // Joi trims + caps length
      if (dto.preview !== undefined) patch.preview = dto.preview;
      if (Object.keys(patch).length > 0) {
        await components.update({ id, userId } as never, {
          ...patch,
          updatedAt: () => 'now()',
        } as never);
      }

      let files: ComponentFile[];
      if (dto.files !== undefined) {
        // Full replace: delete-then-insert keeps (component_id, language)-free
        // semantics while staying consistent inside ONE transaction.
        await em.getRepository(ComponentFile).delete({ componentId: id, userId } as never);
        files = await this.insertFiles(em, userId, id, dto.files);
      } else {
        files = await this.loadFiles(userId, [id]);
      }

      return { ...((await components.findOneBy({ id, userId } as never)) as Component), files };
    });
  }

  // ── DELETE (FK cascade removes the file rows) ──────────────────────────────

  async remove(userId: string, id: string): Promise<{ deleted: boolean; id: string }> {
    const repo = await this.repo();
    const component = await repo.findOneBy({ id, userId } as never);
    if (!component) throw new NotFoundException(`Component ${id} not found`);
    await repo.delete({ id, userId } as never); // component_file cascades (FK)
    return { deleted: true, id };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * Insert one `component_file` row per dto file, in ORDER (round-trips in the
   * order the payload listed them; read queries re-sort by insertion time).
   */
  private async insertFiles(
    em: EntityManager,
    userId: string,
    componentId: string,
    files: CreateComponentDto['files'],
  ): Promise<ComponentFile[]> {
    const fileRepo = em.getRepository(ComponentFile);
    const rows = files.map((file, position) =>
      fileRepo
        .create({
          componentId,
          userId,
          language: file.language,
          code: file.code, // verbatim — never trimmed or reformatted
          position, // payload order survives later reads (created_at is batch-identical)
        } as never) as unknown as ComponentFile,
    );
    return fileRepo.save(rows);
  }

  /**
   * One batched query for ALL files of the given component ids (no N+1).
   * Ordered per-component by the explicit insertion rank (`position`), the
   * batch timestamp as tie-breaker — grouped by caller.
   */
  private async loadFiles(userId: string, componentIds: string[]): Promise<ComponentFile[]> {
    if (componentIds.length === 0) return [];
    return (await this.fileRepo())
      .createQueryBuilder('f')
      .where('f.componentId IN (:...ids)', { ids: componentIds })
      .andWhere('f.userId = :userId', { userId })
      .orderBy('f.position', 'ASC')
      .addOrderBy('f.createdAt', 'ASC')
      .getMany();
  }
}
