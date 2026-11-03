import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import {
  WorkspaceFile,
  WorkspaceFileNode,
  WorkspaceFileType,
} from '../../database/typeorm/entities/workspace-file.entity';
import { Note } from '../../database/typeorm/entities/note.entity';
import { NOTES_DATA_SOURCE } from './notes.tokens';
import type { CreateFileDto } from './dto/create-file.dto';
import type { QueryFilesDto } from './dto/query-files.dto';
import type { UpdateFileDto } from './dto/update-file.dto';

export interface FilePage {
  items: WorkspaceFile[];
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

const SORT_COLUMNS: Record<NonNullable<QueryFilesDto['sortBy']>, string> = {
  position: 'f.position',
  name: 'f.name',
  createdAt: 'f.createdAt',
  updatedAt: 'f.updatedAt',
};

const PG_UNIQUE_VIOLATION = '23505';

/**
 * All queries are scoped by `userId`. Tree mutations (create/move/delete) run
 * inside ONE database transaction so sibling positions stay gap-free and
 * concurrent edits cannot interleave.
 */
@Injectable()
export class FilesService {
  constructor(@Inject(NOTES_DATA_SOURCE) private readonly dataSource: DataSource) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  private async repo(): Promise<Repository<WorkspaceFile>> {
    return (await this.ready()).getRepository(WorkspaceFile);
  }

  // ── TREE (single query, assembled in memory — O(n)) ────────────────────────

  /** Full workspace tree for the user (nested folders, children sorted). */
  async tree(userId: string): Promise<WorkspaceFileNode[]> {
    const all = await (await this.repo())
      .createQueryBuilder('f')
      .where('f.userId = :userId', { userId })
      .orderBy('f.position', 'ASC')
      .addOrderBy('f.createdAt', 'ASC')
      .getMany();

    const nodes = new Map<string, WorkspaceFileNode>();
    for (const f of all) {
      nodes.set(f.id, {
        id: f.id,
        name: f.name,
        type: f.type,
        parentId: f.parentId,
        position: f.position,
        children: [],
      });
    }
    const roots: WorkspaceFileNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  // ── FOLDER CONTENTS (paginated + search + filter + sort) ──────────────────

  async list(userId: string, query: QueryFilesDto): Promise<FilePage> {
    const { page, limit } = clampPagination(query.page, query.limit);
    const repo = await this.repo();

    const qb = repo.createQueryBuilder('f').where('f.userId = :userId', { userId });

    // Omitted parentId lists the workspace ROOT (parent_id IS NULL).
    if (query.parentId) {
      qb.andWhere('f.parentId = :parentId', { parentId: query.parentId });
    } else {
      qb.andWhere('f.parentId IS NULL');
    }

    if (query.type) {
      qb.andWhere('f.type = :type', { type: query.type });
    }
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      qb.andWhere("f.name ILIKE :searchPattern ESCAPE '\\'", { searchPattern: pattern });
    }

    const sortBy = query.sortBy ?? 'position';
    const sortOrder: 'asc' | 'desc' =
      query.sortOrder ??
      (sortBy === 'position' || sortBy === 'name' ? 'asc' : 'desc');
    const dir = sortOrder.toUpperCase() as 'ASC' | 'DESC';

    // Count with the SAME filters (cloned before select/order/pagination).
    const countPromise = qb
      .clone()
      .select('COUNT(f.id)', 'cnt')
      .getRawOne<{ cnt: string | number }>();

    qb.orderBy(SORT_COLUMNS[sortBy], dir);
    qb.addOrderBy('f.createdAt', 'DESC'); // stable tie-breaker
    qb.skip((page - 1) * limit).take(limit);

    const [items, countRow] = await Promise.all([
      qb.getMany(),
      countPromise.then((row) => Number(row?.cnt ?? 0)),
    ]);
    const total = Number(countRow ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return { items, total, page, limit, totalPages };
  }

  // ── CREATE (transactional: position + note seeding) ────────────────────────

  async create(userId: string, dto: CreateFileDto): Promise<WorkspaceFile> {
    const ds = await this.ready();
    return ds.transaction<WorkspaceFile>(async (em) => {
      const files = em.getRepository(WorkspaceFile);

      if (dto.parentId) {
        const parent = await files.findOneBy({ id: dto.parentId, userId } as never);
        if (!parent) throw new NotFoundException(`Parent folder ${dto.parentId} not found`);
        if (parent.type !== 'folder') {
          throw new BadRequestException('Parent must be a folder');
        }
      }

      await this.assertSiblingNameFree(files, userId, dto.parentId, dto.name);

      const position = await this.nextPosition(files, userId, dto.parentId);
      const file = await files.save(
        files.create({
          userId,
          name: dto.name,
          type: dto.type,
          parentId: dto.parentId ?? null,
          position,
        } as never) as unknown as WorkspaceFile,
      );

      if (dto.type === 'file') {
        // Seed the 1:1 note row in the SAME transaction — a file without a
        // note row can never exist.
        await em.getRepository(Note).save(
          em.getRepository(Note).create({
            fileId: file.id,
            userId,
            content: dto.content ?? '',
          } as never),
        );
      }
      return file;
    });
  }

  // ── UPDATE (rename and/or move — cycle-checked, position-aware) ───────────

  async update(userId: string, id: string, dto: UpdateFileDto): Promise<WorkspaceFile> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field to update is required');
    }
    const ds = await this.ready();
    return ds.transaction<WorkspaceFile>(async (em) => {
      const files = em.getRepository(WorkspaceFile);
      // Ownership in the lookup: another user's id → 404.
      const file = await files.findOneBy({ id, userId } as never);
      if (!file) throw new NotFoundException(`File ${id} not found`);

      const newParentId = dto.parentId !== undefined ? dto.parentId : file.parentId;
      const newParentChanged = (newParentId ?? null) !== (file.parentId ?? null);
      const name = dto.name ?? file.name;

      // Keep the .html extension contract for files (folders are free-form).
      if (file.type === 'file' && !/\.html$/i.test(name)) {
        throw new BadRequestException('file name must end with .html');
      }

      if (newParentChanged) {
        if (newParentId) {
          const parent = await files.findOneBy({ id: newParentId, userId } as never);
          if (!parent) throw new NotFoundException(`Parent folder ${newParentId} not found`);
          if (parent.type !== 'folder') {
            throw new BadRequestException('Parent must be a folder');
          }
          if (parent.id === file.id) {
            throw new BadRequestException('A folder cannot be moved into itself');
          }
          // Moving a folder into its own descendant would create a cycle.
          const all = await files.find({ where: { userId } as never });
          if (this.isDescendant(all, file.id, newParentId)) {
            throw new BadRequestException('Cannot move a folder into its own subtree');
          }
        }
      }

      await this.assertSiblingNameFree(files, userId, newParentId, name, id);

      if (newParentChanged) {
        // Append at the end of the destination folder's ordering, then close
        // the gap left behind in the source folder.
        const oldPosition = file.position;
        file.position = await this.nextPosition(files, userId, newParentId);
        await files
          .createQueryBuilder()
          .update(WorkspaceFile)
          .set({ position: () => 'position - 1' })
          .where(
            'user_id = :userId AND parent_id IS NOT DISTINCT FROM :oldParent::uuid AND position > :pos',
            { userId, oldParent: file.parentId ?? null, pos: oldPosition },
          )
          .execute();
        file.parentId = newParentId ?? null;
      }

      file.name = name;
      await files.update({ id, userId } as never, {
        name: file.name,
        parentId: file.parentId,
        position: file.position,
        updatedAt: () => 'now()',
      } as never);

      return (await files.findOneBy({ id, userId } as never)) as WorkspaceFile;
    });
  }

  // ── DELETE (cascade via FK, gap-free siblings — one transaction) ──────────

  async remove(userId: string, id: string): Promise<{ deleted: boolean; id: string }> {
    const ds = await this.ready();
    return ds.transaction(async (em) => {
      const files = em.getRepository(WorkspaceFile);
      const row = await files.findOneBy({ id, userId } as never);
      if (!row) throw new NotFoundException(`File ${id} not found`);

      // ON DELETE CASCADE removes descendants and their note rows.
      await files.delete({ id, userId } as never);
      // Close the gap so sibling positions stay 0-based + gap-free.
      await files
        .createQueryBuilder()
        .update(WorkspaceFile)
        .set({ position: () => 'position - 1' })
        .where(
          'user_id = :userId AND parent_id IS NOT DISTINCT FROM :parent::uuid AND position > :pos',
          { userId, parent: row.parentId ?? null, pos: row.position },
        )
        .execute();

      return { deleted: true, id };
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Next gap-free position among the user's siblings of `parentId`. */
  private async nextPosition(
    files: Repository<WorkspaceFile>,
    userId: string,
    parentId: string | null,
  ): Promise<number> {
    const row = await files
      .createQueryBuilder('f')
      .select('COALESCE(MAX(f.position), -1)', 'maxPos')
      .where('f.userId = :userId', { userId })
      .andWhere('f.parentId IS NOT DISTINCT FROM :parentId', { parentId })
      .getRawOne<{ maxPos: string | number }>();
    return Number(row?.maxPos ?? -1) + 1;
  }

  /**
   * Sibling names are case-insensitively unique per user + parent (DB-backed
   * by `uq_workspace_file_sibling_name`). Explicit check → clear 409; the
   * unique index is the race-condition backstop.
   */
  private async assertSiblingNameFree(
    files: Repository<WorkspaceFile>,
    userId: string,
    parentId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const qb = files
      .createQueryBuilder('f')
      .where('f.userId = :userId', { userId })
      .andWhere('f.parentId IS NOT DISTINCT FROM :parentId', { parentId })
      .andWhere('lower(f.name) = lower(:name)', { name });
    if (excludeId) qb.andWhere('f.id != :excludeId', { excludeId });
    const clash = await qb.getOne();
    if (clash) {
      throw new ConflictException(`"${name}" already exists in this folder`);
    }
  }

  /** Is `candidateParentId` inside the subtree rooted at `rootId`? */
  private isDescendant(
    all: WorkspaceFile[],
    rootId: string,
    candidateParentId: string,
  ): boolean {
    const byParent = new Map<string | null, string[]>();
    for (const f of all) {
      const list = byParent.get(f.parentId) ?? [];
      list.push(f.id);
      byParent.set(f.parentId, list);
    }
    const queue = [...(byParent.get(rootId) ?? [])];
    const seen = new Set<string>([rootId]);
    while (queue.length) {
      const current = queue.pop() as string;
      if (current === candidateParentId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      queue.push(...(byParent.get(current) ?? []));
    }
    return false;
  }

  /** Map a Postgres unique-violation to 409 (used by callers that upsert). */
  static isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === PG_UNIQUE_VIOLATION
    );
  }
}
