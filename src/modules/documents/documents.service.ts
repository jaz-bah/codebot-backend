import { BadRequestException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Document } from '../../database/typeorm/entities/document.entity';
import { DOCUMENTS_DATA_SOURCE } from './documents.tokens';
import type { CreateDocumentDto } from './dto/create-document.dto';
import type { QueryDocumentsDto } from './dto/query-documents.dto';
import type { UpdateDocumentDto } from './dto/update-document.dto';
import {
  DOCUMENT_DESCRIPTION_MAX_LENGTH,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_NAME_MAX_LENGTH,
} from './dto/document.constants';
import { SettingsService } from '../settings/settings.service';
import { CloudinaryClient } from '../uploads/cloudinary-client';
import type { CloudinaryCredentials } from '../uploads/cloudinary-credentials';
import type { UploadFile } from '../uploads/multer-file.interceptor';
import { detectImageKind, sanitizeFilename } from '../uploads/upload-file-types';

/** Cloudinary folder for document assets (sub-folder of the uploads root). */
export const documentsFolder = (userId: string): string => `codebot/${userId}/documents`;

export interface DocumentPage {
  items: Document[];
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

const SORT_COLUMNS: Record<NonNullable<QueryDocumentsDto['sortBy']>, string> = {
  createdAt: 'd.createdAt',
  updatedAt: 'd.updatedAt',
  name: 'd.name',
};

/**
 * All queries are scoped by `userId`. Creating a document uploads the bytes to
 * the user's OWN Cloudinary account (credentials from /settings, decrypted
 * server-side only) and persists the metadata row (name, description, url).
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DOCUMENTS_DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(SettingsService) private readonly settings: SettingsService,
    private readonly cloudinary: CloudinaryClient,
  ) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  private async repo(): Promise<Repository<Document>> {
    return (await this.ready()).getRepository(Document);
  }

  // ── CREATE (upload bytes → persist metadata) ───────────────────────────────

  async create(userId: string, dto: CreateDocumentDto, file: UploadFile | undefined): Promise<Document> {
    const f = this.assertFilePresent(file);
    const saved = await this.uploadBytes(userId, f);
    const repo = await this.repo();
    // Name falls back to the sanitized original filename.
    const name = dto.name ?? saved.filename;
    if (name.length > DOCUMENT_NAME_MAX_LENGTH) {
      throw new BadRequestException(`name must not exceed ${DOCUMENT_NAME_MAX_LENGTH} characters`);
    }
    if ((dto.description ?? '').length > DOCUMENT_DESCRIPTION_MAX_LENGTH) {
      throw new BadRequestException(`description must not exceed ${DOCUMENT_DESCRIPTION_MAX_LENGTH} characters`);
    }
    return repo.save(
      repo.create({
        userId,
        name,
        description: dto.description ?? null,
        url: saved.result.url,
      } as never) as unknown as Document,
    );
  }

  // ── READ (paginated + search + sort) ───────────────────────────────────────

  async list(userId: string, query: QueryDocumentsDto): Promise<DocumentPage> {
    const { page, limit } = clampPagination(query.page, query.limit);
    const repo = await this.repo();

    const qb = repo.createQueryBuilder('d').where('d.userId = :userId', { userId });

    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      qb.andWhere(
        "(d.name ILIKE :searchPattern ESCAPE '\\' OR d.description ILIKE :searchPattern ESCAPE '\\')",
        { searchPattern: pattern },
      );
    }

    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder: 'asc' | 'desc' =
      query.sortOrder ?? (sortBy === 'name' ? 'asc' : 'desc');
    const dir = sortOrder.toUpperCase() as 'ASC' | 'DESC';

    // Count with the SAME filters (cloned before select/order/pagination).
    const countPromise = qb
      .clone()
      .select('COUNT(d.id)', 'cnt')
      .getRawOne<{ cnt: string | number }>();

    qb.orderBy(SORT_COLUMNS[sortBy], dir);
    qb.addOrderBy('d.createdAt', 'DESC'); // stable tie-breaker
    qb.skip((page - 1) * limit).take(limit);

    const [items, countRow] = await Promise.all([
      qb.getMany(),
      countPromise.then((row) => Number(row?.cnt ?? 0)),
    ]);
    const total = Number(countRow ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return { items, total, page, limit, totalPages };
  }

  async findOne(userId: string, id: string): Promise<Document> {
    const doc = await (await this.repo()).findOneBy({ id, userId } as never);
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  // ── UPDATE (metadata only — name/description) ──────────────────────────────

  async update(userId: string, id: string, dto: UpdateDocumentDto): Promise<Document> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field to update is required');
    }
    const repo = await this.repo();
    // Ownership in the lookup: another user's id → 404.
    const doc = await repo.findOneBy({ id, userId } as never);
    if (!doc) throw new NotFoundException(`Document ${id} not found`);

    const name = dto.name ?? doc.name;
    if (name.length > DOCUMENT_NAME_MAX_LENGTH) {
      throw new BadRequestException(`name must not exceed ${DOCUMENT_NAME_MAX_LENGTH} characters`);
    }
    // undefined → keep current; explicit null → clear.
    const description = dto.description !== undefined ? dto.description : doc.description;
    if ((description ?? '').length > DOCUMENT_DESCRIPTION_MAX_LENGTH) {
      throw new BadRequestException(`description must not exceed ${DOCUMENT_DESCRIPTION_MAX_LENGTH} characters`);
    }

    await repo.update({ id, userId } as never, {
      name,
      description,
      updatedAt: () => 'now()',
    } as never);

    return (await repo.findOneBy({ id, userId } as never)) as Document;
  }

  // ── DELETE (DB row only — the Cloudinary asset stays in the user's account) ─

  async remove(userId: string, id: string): Promise<{ deleted: boolean; id: string }> {
    const repo = await this.repo();
    const doc = await repo.findOneBy({ id, userId } as never);
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    await repo.delete({ id, userId } as never);
    return { deleted: true, id };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Throws when absent/empty or over the size cap; returns the narrowed file. */
  private assertFilePresent(file: UploadFile | undefined): UploadFile {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('file is required (multipart field "file")');
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      throw new PayloadTooLargeException(`file exceeds the ${DOCUMENT_MAX_BYTES} byte limit`);
    }
    return file;
  }

  /**
   * Sends the bytes to the user's Cloudinary (credentials via /settings).
   * Content is uploaded to the `image` endpoint when the MAGIC BYTES detect a
   * supported image (jpg/png/webp/gif) for optimized delivery, otherwise the
   * `raw` endpoint. Any content type is accepted — this is a general file
   * system, not a validator.
   */
  private async uploadBytes(
    userId: string,
    file: UploadFile,
  ): Promise<{ result: { url: string }; filename: string }> {
    const creds: CloudinaryCredentials | null = await this.settings.getCloudinaryCredentials(userId);
    if (!creds) {
      throw new BadRequestException(
        'Cloudinary credentials are not configured — set them via PATCH /settings first',
      );
    }
    const filename = sanitizeFilename(file.originalname);
    const resourceType = detectImageKind(file.buffer) ? 'image' : 'raw';
    const result = await this.cloudinary.upload({
      buffer: file.buffer,
      filename,
      mimetype: file.mimetype,
      resourceType,
      creds,
      folder: documentsFolder(userId),
    });
    return { result, filename };
  }
}
