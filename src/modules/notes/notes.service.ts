import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Note } from '../../database/typeorm/entities/note.entity';
import { WorkspaceFile } from '../../database/typeorm/entities/workspace-file.entity';
import { NOTES_DATA_SOURCE } from './notes.tokens';
import { FilesService } from './files.service';
import type { QueryNotesDto } from './dto/query-notes.dto';
import type { UpdateNoteDto } from './dto/update-note.dto';

/** A note row joined with its file metadata (list shape — no heavy content). */
export interface NoteMeta {
  id: string;
  fileId: string;
  fileName: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A list row: meta + tag-stripped content preview. */
export interface NoteListItem extends NoteMeta {
  preview: string;
}

/** Full note payload — raw rich HTML content included. */
export interface NoteDetail extends NoteMeta {
  content: string;
}

export interface NotePage {
  items: NoteListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const PREVIEW_LENGTH = 200;

const clampPagination = (page?: number, limit?: number): { page: number; limit: number } => {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  return { page: safePage, limit: safeLimit };
};

/** Escape LIKE wildcards in user input so `100%` does not match everything. */
const escapeLike = (input: string): string => input.replace(/([%_\\])/g, '\\$1');

const SORT_COLUMNS: Record<NonNullable<QueryNotesDto['sortBy']>, string> = {
  createdAt: 'n.created_at',
  updatedAt: 'n.updated_at',
  fileName: 'f.name',
};

/**
 * All queries are scoped by `userId` (denormalized onto the note row — files
 * never change owner). Content updates stamp `updatedAt` on the DATABASE
 * clock. Note rows are 1:1 with workspace files; a missing file → 404, a
 * non-`file` (folder) id → 400.
 */
@Injectable()
export class NotesService {
  constructor(@Inject(NOTES_DATA_SOURCE) private readonly dataSource: DataSource) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  // ── LIST (paginated + search + folder filter + sort) ───────────────────────

  async list(userId: string, query: QueryNotesDto): Promise<NotePage> {
    const { page, limit } = clampPagination(query.page, query.limit);
    const repo = (await this.ready()).getRepository(Note);

    const qb = repo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .leftJoin(WorkspaceFile, 'f', 'f.id = n.fileId')
      .select('n.id', 'id')
      .addSelect('n.file_id', 'fileId')
      .addSelect('f.name', 'fileName')
      .addSelect('f.parent_id', 'folderId')
      .addSelect(
        // Tag-stripped, whitespace-collapsed preview — no client round-trip.
        `left(btrim(regexp_replace(n.content, '<[^>]*>', ' ', 'g')), ${PREVIEW_LENGTH})`,
        'preview',
      )
      .addSelect('n.created_at', 'createdAt')
      .addSelect('n.updated_at', 'updatedAt');

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      qb.andWhere(
        "(n.content ILIKE :searchPattern ESCAPE '\\' OR f.name ILIKE :searchPattern ESCAPE '\\')",
        { searchPattern: pattern },
      );
    }
    if (query.folderId) {
      qb.andWhere('f.parent_id = :folderId', { folderId: query.folderId });
    }

    const sortBy = query.sortBy ?? 'updatedAt';
    const sortOrder: 'asc' | 'desc' = query.sortOrder ?? 'desc';
    const dir = sortOrder.toUpperCase() as 'ASC' | 'DESC';

    // Count with the SAME filters (cloned before order/pagination).
    const countPromise = qb.clone().select('COUNT(DISTINCT n.id)', 'cnt').getRawOne();

    qb.orderBy(SORT_COLUMNS[sortBy], dir);
    qb.addOrderBy('n.updated_at', 'DESC'); // stable tie-breaker
    qb.skip((page - 1) * limit).take(limit);

    const [rows, countRow] = await Promise.all([
      qb.getRawMany<{
        id: string;
        fileId: string;
        fileName: string;
        folderId: string | null;
        preview: string;
        createdAt: Date;
        updatedAt: Date;
      }>(),
      countPromise.then((row) => Number((row as { cnt?: string | number } | undefined)?.cnt ?? 0)),
    ]);

    const items: NoteListItem[] = rows.map((r) => ({
      id: r.id,
      fileId: r.fileId,
      fileName: r.fileName,
      folderId: r.folderId,
      preview: r.preview ?? '',
      createdAt: r.createdAt?.toISOString?.() ?? String(r.createdAt),
      updatedAt: r.updatedAt?.toISOString?.() ?? String(r.updatedAt),
    }));
    const total = Number(countRow ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return { items, total, page, limit, totalPages };
  }

  // ── READ (single note content by its file id) ─────────────────────────────

  async getByFile(userId: string, fileId: string): Promise<NoteDetail> {
    const repo = (await this.ready()).getRepository(Note);
    const row = await repo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId })
      .andWhere('n.fileId = :fileId', { fileId })
      .leftJoin(WorkspaceFile, 'f', 'f.id = n.fileId')
      .select('n.id', 'id')
      .addSelect('n.file_id', 'fileId')
      .addSelect('n.content', 'content')
      .addSelect('n.created_at', 'createdAt')
      .addSelect('n.updated_at', 'updatedAt')
      .addSelect('f.name', 'fileName')
      .addSelect('f.parent_id', 'folderId')
      .addSelect('f.type', 'fileType')
      .getRawOne<{
        id: string;
        fileId: string;
        content: string;
        createdAt: Date;
        updatedAt: Date;
        fileName: string;
        folderId: string | null;
        fileType: string;
      }>();

    if (!row) {
      // Distinguish "file exists but is a folder" (400) from "not yours / not
      // there" (404) — 404 stays the default for anything not owned.
      const file = await (await this.ready())
        .getRepository(WorkspaceFile)
        .findOneBy({ id: fileId, userId } as never);
      if (file && file.type !== 'file') {
        throw new BadRequestException('Folders do not have note content');
      }
      throw new NotFoundException(`Note for file ${fileId} not found`);
    }

    return {
      id: row.id,
      fileId: row.fileId,
      fileName: row.fileName,
      folderId: row.folderId,
      content: row.content ?? '',
      createdAt: row.createdAt?.toISOString?.() ?? String(row.createdAt),
      updatedAt: row.updatedAt?.toISOString?.() ?? String(row.updatedAt),
    };
  }

  // ── UPDATE (upsert content, DB-clock updatedAt) ───────────────────────────

  async update(userId: string, fileId: string, dto: UpdateNoteDto): Promise<NoteDetail> {
    const ds = await this.ready();
    // Write in a transaction, then re-read AFTER commit — a read inside the
    // transaction block runs on a different connection and would see stale
    // content (READ COMMITTED).
    await ds.transaction(async (em) => {
      const files = em.getRepository(WorkspaceFile);
      const notes = em.getRepository(Note);

      // Ownership in the lookup: another user's file → 404.
      const file = await files.findOneBy({ id: fileId, userId } as never);
      if (!file) throw new NotFoundException(`Note for file ${fileId} not found`);
      if (file.type !== 'file') {
        throw new BadRequestException('Folders do not have note content');
      }

      const existing = await notes.findOneBy({ fileId, userId } as never);
      if (existing) {
        await notes
          .createQueryBuilder()
          .update(Note)
          .set({ content: dto.content, updatedAt: () => 'now()' })
          .where('id = :id AND user_id = :userId', { id: existing.id, userId })
          .execute();
      } else {
        // Defensive upsert: file-but-no-note can only happen via legacy data.
        // The unique constraint is the race backstop.
        await notes.save(
          notes.create({ fileId, userId, content: dto.content } as never),
        );
      }
    });
    return this.getByFile(userId, fileId);
  }

  /** Exposed for tests/tooling: same unique-violation helper as FilesService. */
  static readonly isUniqueViolation = FilesService.isUniqueViolation;
}
