import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Todo } from '../../database/typeorm/entities/todo.entity';
import type { CreateTodoDto } from './dto/create-todo.dto';
import type { QueryTodosDto } from './dto/query-todos.dto';
import type { ReorderTodosDto } from './dto/reorder-todos.dto';
import type { UpdateTodoDto } from './dto/update-todo.dto';

/** DI token for the shared TypeORM DataSource (domain tables). */
export const TODO_DATA_SOURCE = 'TODO_DATA_SOURCE';

export interface TodoPage {
  items: Todo[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReorderResult {
  /** Number of rows whose position changed. */
  reordered: number;
  /** Final full ordering of the user's todos (ids, index == position). */
  order: string[];
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

const SORT_COLUMNS: Record<Exclude<NonNullable<QueryTodosDto['sortBy']>, 'priority'>, string> = {
  createdAt: 't.createdAt',
  dueDate: 't.dueDate',
  position: 't.position',
};

/** Priority sorts by RANK (urgent > high > medium > low), not alphabetically. */
const PRIORITY_RANK_SQL =
  "CASE t.priority WHEN 'urgent' THEN 3 WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END";

/**
 * All queries are scoped by `userId`. Mutations that must keep per-user
 * ordering gap-free and race-safe run inside ONE database transaction.
 */
@Injectable()
export class TodosService {
  constructor(@Inject(TODO_DATA_SOURCE) private readonly dataSource: DataSource) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  private async repo(): Promise<Repository<Todo>> {
    return (await this.ready()).getRepository(Todo);
  }

  // ── CREATE ─────────────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateTodoDto): Promise<Todo> {
    const ds = await this.ready();
    return ds.transaction<Todo>(async (em) => {
      const repo = em.getRepository(Todo);

      let position = dto.position;
      if (position == null) {
        // Append at the end of the user's ordering (max+1, 0-based).
        const row = await repo
          .createQueryBuilder('t')
          .select('COALESCE(MAX(t.position), -1)', 'maxPos')
          .where('t.userId = :userId', { userId })
          .getRawOne();
        position = Number(row?.maxPos ?? -1) + 1;
      }

      const todo = repo.create({
        userId,
        title: dto.title,
        description: dto.description ?? null,
        status: dto.status,
        priority: dto.priority,
        dueDate: dto.dueDate ?? null,
        position,
      } as never) as unknown as Todo;
      return repo.save(todo);
    });
  }

  // ── READ (paginated + search + filter + sort) ──────────────────────────────

  async list(userId: string, query: QueryTodosDto): Promise<TodoPage> {
    // Service-level clamps keep the boundary safe even for direct service use.
    const { page, limit } = clampPagination(query.page, query.limit);
    const repo = await this.repo();

    const qb = repo.createQueryBuilder('t').where('t.userId = :userId', { userId });

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      qb.andWhere(
        "(t.title ILIKE :searchPattern ESCAPE '\\' OR t.description ILIKE :searchPattern ESCAPE '\\')",
        { searchPattern: pattern },
      );
    }
    if (query.status) {
      qb.andWhere('t.status = :status', { status: query.status });
    }
    if (query.priority) {
      qb.andWhere('t.priority = :priority', { priority: query.priority });
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder: 'asc' | 'desc' = query.sortOrder ?? (sortBy === 'position' ? 'asc' : 'desc');
    const dir = sortOrder.toUpperCase() as 'ASC' | 'DESC';

    // Count with the SAME filters (cloned before select/order/pagination).
    const countPromise = qb
      .clone()
      .select('COUNT(t.id)', 'cnt')
      .getRawOne<{ cnt: string | number }>();

    if (sortBy === 'priority') {
      qb.addSelect(PRIORITY_RANK_SQL, 'priorityRank').orderBy('priorityRank', dir);
      qb.addOrderBy('t.createdAt', 'DESC'); // stable tie-breaker
    } else {
      qb.orderBy(SORT_COLUMNS[sortBy], dir);
      qb.addOrderBy('t.createdAt', 'DESC');
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

  async findOne(userId: string, id: string): Promise<Todo> {
    const todo = await (await this.repo()).findOneBy({ id, userId } as never);
    if (!todo) throw new NotFoundException(`Todo ${id} not found`);
    return todo;
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────

  async update(userId: string, id: string, dto: UpdateTodoDto): Promise<Todo> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field to update is required');
    }
    const repo = await this.repo();
    // Ownership in the WHERE clause: another user's id → 0 affected → 404.
    // `now()` keeps updatedAt on the DATABASE clock (client clocks can skew).
    const result = await repo
      .createQueryBuilder()
      .update(Todo)
      .set({
        ...(dto as Record<string, unknown>),
        updatedAt: () => 'now()',
      })
      .where('id = :id AND user_id = :userId', { id, userId })
      .execute();
    if (!result.affected) throw new NotFoundException(`Todo ${id} not found`);

    const todo = await repo.findOneBy({ id, userId } as never);
    if (!todo) throw new NotFoundException(`Todo ${id} not found`);
    return todo;
  }

  // ── DELETE (compacts the ordering inside a transaction) ────────────────────

  async remove(userId: string, id: string): Promise<{ deleted: boolean; id: string }> {
    const ds = await this.ready();
    return ds.transaction(async (em) => {
      const repo = em.getRepository(Todo);
      const row = await repo.findOneBy({ id, userId } as never);
      if (!row) throw new NotFoundException(`Todo ${id} not found`);

      await repo.delete({ id, userId } as never);
      // Close the gap so positions stay 0-based + gap-free.
      await repo
        .createQueryBuilder()
        .update(Todo)
        .set({ position: () => 'position - 1' })
        .where('userId = :userId AND position > :pos', { userId, pos: row.position })
        .execute();

      return { deleted: true, id };
    });
  }

  // ── REORDER (transactional, gap-free, subset-friendly) ─────────────────────

  /**
   * Explicit position assignments: `{ items: [{ id, position }] }`.
   *
   * Rules:
   * - every id must belong to the caller (else 404);
   * - ids and positions must be unique, positions < total count (else 400);
   * - items NOT mentioned keep their relative order and fill the gaps.
   *
   * Computed once, then applied in ONE transaction — no torn reads/interleaved
   * orderings even under concurrent drags.
   */
  async reorder(userId: string, dto: ReorderTodosDto): Promise<ReorderResult> {
    const ds = await this.ready();
    return ds.transaction(async (em) => {
      const repo = em.getRepository(Todo);
      const all = await repo.find({
        where: { userId } as never,
        order: { position: 'ASC', createdAt: 'ASC' } as never,
      });

      const requestedIds = new Set<string>();
      const requestedPosById = new Map<string, number>();
      const requestedIdByPos = new Map<number, string>();
      for (const item of dto.items) {
        if (!all.some((t) => t.id === item.id)) {
          throw new NotFoundException(`Todo ${item.id} not found`);
        }
        if (requestedIds.has(item.id)) {
          throw new BadRequestException(`Duplicate todo id in reorder payload: ${item.id}`);
        }
        if (item.position >= all.length) {
          throw new BadRequestException(
            `Position ${item.position} is out of range (0..${all.length - 1})`,
          );
        }
        if (requestedIdByPos.has(item.position)) {
          throw new BadRequestException(`Duplicate position ${item.position} in reorder payload`);
        }
        requestedIds.add(item.id);
        requestedPosById.set(item.id, item.position);
        requestedIdByPos.set(item.position, item.id);
      }

      if (!requestedIds.size) {
        throw new BadRequestException('Reorder payload must not be empty');
      }

      // Final ordering: requested items at their explicit slots; unmentioned
      // items keep their current relative order in the remaining slots.
      const unmentioned = all.map((t) => t.id).filter((id) => !requestedIds.has(id));
      let fillIdx = 0;
      const finalOrder: string[] = [];
      for (let i = 0; i < all.length; i++) {
        const explicit = requestedIdByPos.get(i);
        finalOrder.push(explicit ?? unmentioned[fillIdx++]);
      }

      const numberOf = new Map(all.map((t) => [t.id, t.position]));
      let reordered = 0;
      for (let i = 0; i < finalOrder.length; i++) {
        const id = finalOrder[i];
        if (numberOf.get(id) === i) continue; // unchanged → skip the write
        await repo.update({ id, userId } as never, { position: i } as never);
        reordered++;
      }

      return { reordered, order: finalOrder };
    });
  }
}
