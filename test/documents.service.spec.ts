import { DocumentsService } from '../src/modules/documents/documents.service';
import type { CreateDocumentDto } from '../src/modules/documents/dto/create-document.dto';
import type { QueryDocumentsDto } from '../src/modules/documents/dto/query-documents.dto';
import type { CloudinaryUploadResult } from '../src/modules/uploads/cloudinary-client';
import type { UploadFile } from '../src/modules/uploads/multer-file.interceptor';

/**
 * DocumentsService unit tests against hand-rolled fakes (no real DB or
 * Cloudinary) — upload orchestration, name fallback, ownership scoping,
 * pagination clamps, metadata-only updates.
 */

interface RowLike {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  url: string;
  createdAt?: Date;
  updatedAt?: Date;
  [k: string]: unknown;
}

class FakeQb {
  tracker: string[] = [];
  constructor(
    private readonly repo: FakeRepo,
    private readonly isClone = false,
  ) {}

  where(..._: unknown[]): FakeQb {
    this.tracker.push('where');
    return this;
  }
  andWhere(): FakeQb {
    this.tracker.push('andWhere');
    return this;
  }
  clone(): FakeQb {
    this.tracker.push('clone');
    const clone = new FakeQb(this.repo, true);
    this.repo.lastClone = clone;
    return clone;
  }
  select(...args: unknown[]): FakeQb {
    this.tracker.push(`select(${args[0]})`);
    return this;
  }
  orderBy(...args: unknown[]): FakeQb {
    this.tracker.push(`orderBy(${args.join(' ')})`);
    return this;
  }
  addOrderBy(...args: unknown[]): FakeQb {
    this.tracker.push(`addOrderBy(${args.join(' ')})`);
    return this;
  }
  skip(v: number): FakeQb {
    this.tracker.push(`skip(${v})`);
    return this;
  }
  take(v: number): FakeQb {
    this.tracker.push(`take(${v})`);
    return this;
  }
  async getMany(): Promise<unknown[]> {
    this.tracker.push('getMany');
    return this.repo.rows;
  }
  async getRawOne<T>(): Promise<T | undefined> {
    this.tracker.push('getRawOne');
    return this.repo.rows.length > 0
      ? ({ cnt: this.repo.rows.length } as unknown as T)
      : ({ cnt: 0 } as unknown as T);
  }
}

class FakeRepo {
  rows: RowLike[] = [];
  qb = new FakeQb(this);
  lastClone?: FakeQb;
  private nextId = 1;

  createQueryBuilder(): FakeQb {
    return this.qb;
  }

  async findOneBy<T extends Record<string, unknown>>(criteria: T): Promise<RowLike | null> {
    const hits = this.rows.filter((row) =>
      Object.entries(criteria as unknown as RowLike).every(([key, value]) => row[key] === value),
    );
    return hits[0] ?? null;
  }

  async update<T extends Record<string, unknown>>(
    criteria: T,
    patch: Record<string, unknown>,
  ): Promise<void> {
    for (const row of this.rows) {
      if (Object.entries(criteria as unknown as RowLike).every(([key, value]) => row[key] === value)) {
        Object.assign(row, patch, {
          updatedAt: typeof patch.updatedAt === 'function' ? new Date() : patch.updatedAt,
        });
      }
    }
  }

  async delete<T extends Record<string, unknown>>(criteria: T): Promise<void> {
    this.rows = this.rows.filter(
      (row) => !Object.entries(criteria as unknown as RowLike).every(([key, value]) => row[key] === value),
    );
  }

  create(seed: Record<string, unknown>): RowLike {
    return { id: `doc-${this.nextId++}`, createdAt: new Date(), ...seed } as RowLike;
  }

  async save(row: RowLike): Promise<RowLike> {
    this.rows.push(row);
    return row;
  }
}

const makeFile = (bytes: number[] | Buffer, name = 'doc.txt', size?: number): UploadFile =>
  ({
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    buffer: Array.isArray(bytes) ? Buffer.from(bytes) : bytes,
    size: size ?? (Array.isArray(bytes) ? bytes.length : bytes.byteLength),
  }) as unknown as UploadFile;

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0];
const TEXT_BYTES = [...Buffer.from('plain text, not an image')];

const CLIENT_RESULT: CloudinaryUploadResult = {
  url: 'https://res.cloudinary.com/my-cloud/raw/upload/codebot/u1/documents/doc.txt',
  publicId: 'codebot/u1/documents/doc',
  resourceType: 'raw',
  format: null,
  bytes: 16,
};

const CREDS = { cloudName: 'my-cloud', apiKey: 'key-123', apiSecret: 'secret-456' };

/** Service-level DTOs arrive Joi-normalized: `description` defaults to null. */
const dto = (partial: Partial<CreateDocumentDto>): CreateDocumentDto => ({
  description: null,
  ...partial,
});
const query = (partial: Partial<QueryDocumentsDto>): QueryDocumentsDto =>
  partial as QueryDocumentsDto;

const makeDeps = (creds: typeof CREDS | null = CREDS) => {
  const repo = new FakeRepo();
  const dataSource = {
    isInitialized: true,
    initialize: jest.fn(),
    getRepository: jest.fn().mockReturnValue(repo),
  };
  const settings = { getCloudinaryCredentials: jest.fn().mockResolvedValue(creds) };
  const cloudinary = { upload: jest.fn().mockResolvedValue(CLIENT_RESULT) };
  const svc = new DocumentsService(
    dataSource as never,
    settings as never,
    cloudinary as never,
  );
  return { svc, repo, settings, cloudinary, dataSource };
};

describe('DocumentsService — create', () => {
  it('uploads the bytes to the user folder and persists name/description/url', async () => {
    const { svc, repo, cloudinary } = makeDeps();
    const doc = await svc.create('u1', dto({ description: 'invoice scan' }), makeFile(PNG_BYTES, 'receipt.png'));

    expect(cloudinary.upload).toHaveBeenCalledTimes(1);
    expect(cloudinary.upload.mock.calls[0][0]).toMatchObject({
      resourceType: 'image', // image magic bytes → optimized image endpoint
      folder: 'codebot/u1/documents',
      filename: 'receipt.png',
    });
    // Fallback name = sanitized filename.
    expect(doc).toMatchObject({
      userId: 'u1',
      name: 'receipt.png',
      description: 'invoice scan',
      url: CLIENT_RESULT.url,
    });
    expect(repo.rows).toHaveLength(1);
  });

  it('falls back to the sanitized original filename and prefers the explicit name', async () => {
    const { svc, cloudinary } = makeDeps();
    await svc.create('u1', dto({}), makeFile(TEXT_BYTES, '..\\..\\evil name<>?.bin'));
    expect(cloudinary.upload.mock.calls[0][0].filename).toBe('evil_name_.bin');
    expect(cloudinary.upload.mock.calls[0][0].resourceType).toBe('raw');

    const doc = await svc.create(
      'u1',
      dto({ name: 'My Contract' }),
      makeFile(TEXT_BYTES, 'contract_2026.pdf'),
    );
    expect(doc.name).toBe('My Contract');
  });

  it('gates on Cloudinary credentials and propagates upload failures', async () => {
    const { svc, repo, cloudinary } = makeDeps(null);
    await expect(
      svc.create('u1', dto({}), makeFile(PNG_BYTES, 'ok.png')),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Cloudinary credentials are not configured'),
    });
    expect(repo.rows).toHaveLength(0);

    const failing = makeDeps();
    (failing.cloudinary.upload as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Cloudinary upload failed: bad creds'), { status: 502 }),
    );
    await expect(
      failing.svc.create('u1', dto({}), makeFile(PNG_BYTES, 'ok.png')),
    ).rejects.toMatchObject({ status: 502 });
    expect(failing.repo.rows).toHaveLength(0);
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });

  it('rejects a missing/empty file with 400 and oversized files with 413', async () => {
    const { svc, repo } = makeDeps();
    await expect(svc.create('u1', dto({}), undefined)).rejects.toMatchObject({ status: 400 });
    await expect(svc.create('u1', dto({}), makeFile([], 'empty.txt', 0))).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.create('u1', dto({}), makeFile(Buffer.alloc(50 * 1024 * 1024 + 1, 1), 'big.bin')),
    ).rejects.toMatchObject({ status: 413 });
    expect(repo.rows).toHaveLength(0);
  });

  it('validates name/description lengths (JWT-independent, service level)', async () => {
    const { svc, repo } = makeDeps();
    await expect(
      svc.create('u1', dto({ name: 'a'.repeat(256) }), makeFile(PNG_BYTES)),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.create('u1', dto({ description: 'x'.repeat(5001) }), makeFile(PNG_BYTES)),
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.rows).toHaveLength(0);
  });
});

describe('DocumentsService — update', () => {
  it('rejects an empty patch with 400', async () => {
    const { svc } = makeDeps();
    await expect(svc.update('u1', 'doc-1', {})).rejects.toMatchObject({ status: 400 });
  });

  it('applies name/description patches and clears the description on explicit null', async () => {
    const { svc, repo } = makeDeps();
    const seeded = await repo.save(
      repo.create({
        userId: 'u1',
        name: 'Old name',
        description: 'Old description',
        url: 'https://res.cloudinary.com/my-cloud/raw/upload/x',
      }),
    );

    const renamed = await svc.update('u1', seeded.id, { description: null });
    expect(renamed.name).toBe('Old name'); // untouched field stays
    expect(renamed.description).toBeNull();

    const fully = await svc.update('u1', seeded.id, { name: 'New name' });
    expect(fully.name).toBe('New name');
    expect(fully.description).toBeNull();
  });

  it('404s unknown ids and ids belonging to another user (ownership scoping)', async () => {
    const { svc, repo } = makeDeps();
    const seeded = await repo.save(
      repo.create({ userId: 'u1', name: 'A', description: null, url: 'https://x' }),
    );
    await expect(svc.update('u1', 'missing-id', { name: 'B' })).rejects.toMatchObject({ status: 404 });
    await expect(svc.update('someone-else', seeded.id, { name: 'B' })).rejects.toMatchObject({ status: 404 });
    await expect(svc.update('u1', seeded.id, { name: 'a'.repeat(256) })).rejects.toMatchObject({ status: 400 });
  });
});

describe('DocumentsService — findOne/remove', () => {
  it('enforce ownership scoping on every lookup', async () => {
    const { svc, repo } = makeDeps();
    const seeded = await repo.save(
      repo.create({ userId: 'u1', name: 'A', description: null, url: 'https://x' }),
    );

    await expect(svc.findOne('u1', seeded.id)).resolves.toMatchObject({ name: 'A' });
    await expect(svc.findOne('someone-else', seeded.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.remove('someone-else', seeded.id)).rejects.toMatchObject({ status: 404 });

    await expect(svc.remove('u1', seeded.id)).resolves.toMatchObject({ deleted: true, id: seeded.id });
    expect(repo.rows).toHaveLength(0);
  });
});

describe('DocumentsService — list', () => {
  it('clamps pagination, orders by the requested column and counts with the same filters', async () => {
    const { svc, repo } = makeDeps();
    repo.rows = [{ id: 'd1', userId: 'u1', name: 'a', description: null, url: 'https://x' } as RowLike];

    const page = await svc.list('u1', query({ page: 0, limit: 5000, sortBy: 'name', sortOrder: 'desc' }));

    // Ownership scoping is ALWAYS the first step.
    expect(repo.qb.tracker[0]).toBe('where');
    expect(repo.qb.tracker).toContain('skip(0)'); // page 0 → 1, offset 0
    expect(repo.qb.tracker).toContain('take(100)'); // limit clamped to max 100
    expect(repo.qb.tracker).toContain('orderBy(d.name DESC)');
    expect(repo.qb.tracker).toContain('addOrderBy(d.createdAt DESC)');
    // Count runs on the cloned qb (same filters, before order/pagination).
    expect(repo.qb.tracker).toContain('clone');
    expect(repo.lastClone?.tracker).toContain('select(COUNT(d.id))');
    expect(repo.lastClone?.tracker).toContain('getRawOne');
    expect(page).toMatchObject({ total: 1, page: 1, limit: 100, totalPages: 1 });
  });

  it('defaults to newest-first over createdAt and asc over name', async () => {
    const { svc, repo } = makeDeps();
    await svc.list('u1', query({}));
    expect(repo.qb.tracker).toContain('orderBy(d.createdAt DESC)');
    await svc.list('u1', query({ sortBy: 'name' }));
    expect(repo.qb.tracker).toContain('orderBy(d.name ASC)');
  });

  it('adds a search filter over name OR description', async () => {
    const { svc, repo } = makeDeps();
    await svc.list('u1', query({ search: 'invoice' }));
    expect(repo.qb.tracker).toContain('andWhere');
    expect(repo.qb.tracker).toContain('take(20)');
  });
});
