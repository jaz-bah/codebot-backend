import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import type { Kysely } from 'kysely';
import { AuthBaseDB, getAuthKysely } from '../../database/kysely/auth-db';
import { APP_CONFIG } from '../../config/app-config.token';
import type { AppConfig } from '../../config/configuration';
import {
  profileCountsKeyedByTable,
  Profile,
  ProfileUser,
  ProfileView,
} from '../../database/typeorm/entities/profile.entity';
import { PROFILE_DATA_SOURCE } from './profile.tokens';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { ensureUniqueUsername } from '../auth/username-generator';

/** pg error code for a unique-index violation (nickname / user_id clashes). */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Auto-generated handle recipe: `cb` + 5 chars from an unambiguous alphabet
 * (no i/l/o/0/1) → 'cb7f3jq'. Short, typeable, and globally unique by the
 * `uq_profile_nickname` index; generation retries on collisions.
 */
const NICKNAME_PREFIX = 'cb';
const NICKNAME_RANDOM_LENGTH = 5;
const NICKNAME_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const NICKNAME_ATTEMPTS = 5;

export const generateNickname = (): string => {
  const bytes = randomBytes(NICKNAME_RANDOM_LENGTH);
  let out = NICKNAME_PREFIX;
  for (const b of bytes) out += NICKNAME_ALPHABET[b % NICKNAME_ALPHABET.length];
  return out;
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION;

/**
 * One profile row per user (created lazily on first access), plus LIVE
 * content counts. Counts are never stored — one aggregate SQL round-trip
 * per read keeps them incapable of drifting from the real domain tables.
 */
@Injectable()
export class ProfileService {
  constructor(
    @Inject(PROFILE_DATA_SOURCE) private readonly dataSource: DataSource,
    // AppConfig for the auth-DB handle (user.image / username live on the
    // BetterAuth `user` row, NOT on the TypeORM profile row).
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  private async repo(): Promise<Repository<Profile>> {
    return (await this.ready()).getRepository(Profile);
  }

  /**
   * Typed handle over the BetterAuth-owned auth tables. Data-row writes only
   * (profile image, username backfill) — the same channel as admin promotion;
   * the auth SCHEMA itself stays BetterAuth-managed (see database/kysely).
   */
  private authDb(): Kysely<AuthBaseDB> | null {
    if (!this.config?.databaseUrl) return null;
    try {
      return getAuthKysely(this.config.databaseUrl);
    } catch {
      return null;
    }
  }

  /**
   * Fresh user block for the profile payload. Fast path: the session's
   * authUser already carries a username → echo it (zero extra round-trips).
   * Otherwise one read against the auth DB — which ALSO backfills a unique
   * username for legacy rows created before auto-generation existed. Hiccups
   * on the auth side degrade gracefully to the session data instead of
   * breaking the profile.
   */
  private async resolveUser(
    userId: string,
    authUser?: AuthenticatedUser,
  ): Promise<ProfileUser> {
    if (authUser?.username) {
      return {
        id: userId,
        username: authUser.username,
        email: authUser.email ?? '',
        name: authUser.name ?? '',
        image: authUser.image ?? null,
      };
    }
    const db = this.authDb();
    if (db) {
      try {
        const row = await db
          .selectFrom('user')
          .select(['username', 'email', 'name', 'image'])
          .where('id', '=', userId)
          .executeTakeFirst();
        if (row) {
          let username = row.username == null ? null : String(row.username);
          if (!username) {
            username = await this.backfillUsername(db, userId, {
              email: row.email == null ? null : String(row.email),
              name: row.name == null ? null : String(row.name),
            });
          }
          return {
            id: userId,
            username,
            email: row.email == null ? '' : String(row.email),
            name: row.name == null ? '' : String(row.name),
            image: row.image == null ? null : String(row.image),
          };
        }
      } catch {
        // auth-DB hiccup → fall through to session echo
      }
    }
    return {
      id: userId,
      username: authUser?.username ?? null,
      email: authUser?.email ?? '',
      name: authUser?.name ?? '',
      image: authUser?.image ?? null,
    };
  }

  /** Legacy-row backfill: allocate + persist a unique username. Fail-safe. */
  private async backfillUsername(
    db: Kysely<AuthBaseDB>,
    userId: string,
    source: { email: string | null; name: string | null },
  ): Promise<string | null> {
    try {
      const username = await ensureUniqueUsername(db, source);
      await db
        .updateTable('user')
        .set({ username, updatedAt: new Date() })
        .where('id', '=', userId)
        .execute();
      return username;
    } catch {
      // A failed backfill must never break the profile read.
      return null;
    }
  }

  /** Get-or-create, race-safe behind uq_profile_user_id. */
  private async getOrCreate(userId: string): Promise<Profile> {
    const repo = await this.repo();
    const existing = await repo.findOne({ where: { userId } });
    if (existing) return existing;

    for (let attempt = 0; attempt < NICKNAME_ATTEMPTS; attempt++) {
      try {
        return await repo.save(repo.create({ userId, nickname: generateNickname() }));
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Either the nickname collided (retry) or a concurrent request for
        // the SAME user just created the row — re-read covers the latter.
        const raced = await repo.findOne({ where: { userId } });
        if (raced) return raced;
      }
    }
    // Astronomically unlikely: re-read as a last resort, else fail loudly.
    const raced = await repo.findOne({ where: { userId } });
    if (!raced) throw new ConflictException('could not allocate a unique nickname');
    return raced;
  }

  /**
   * All ten counts in ONE round-trip: scalar subselects over every domain
   * table, each pinned to the session user (same ownership rule as search).
   */
  private async counts(userId: string): Promise<Record<string, number>> {
    const ds = await this.ready();
    const selects = profileCountsKeyedByTable
      .map(
        ([table, countName, where]) =>
          `(select count(*) from "${table}" where "user_id" = $1${where})::int as "${countName}"`,
      )
      .join(',\n  ');
    const rows = (await ds.query(
      `select\n  ${selects}`,
      [userId],
    )) as Array<Record<string, number>>;
    return rows[0] ?? {};
  }

  async view(userId: string, authUser?: AuthenticatedUser): Promise<ProfileView> {
    const profile = await this.getOrCreate(userId);
    const user = await this.resolveUser(userId, authUser);
    const counts = await this.counts(userId);
    return {
      nickname: profile.nickname,
      user,
      counts: {
        todos: counts.todos ?? 0,
        notes: counts.notes ?? 0,
        files: counts.files ?? 0,
        folders: counts.folders ?? 0,
        documents: counts.documents ?? 0,
        components: counts.components ?? 0,
        presets: counts.presets ?? 0,
        experts: counts.experts ?? 0,
        tools: counts.tools ?? 0,
        snippets: counts.snippets ?? 0,
      },
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  /** Attach a profile-image URL (the auth `user.image` column) + fresh view. */
  async setImage(userId: string, imageUrl: string): Promise<ProfileView> {
    await this.updateUserColumns(userId, { image: imageUrl });
    // No authUser arg → resolveUser re-reads the ROW, so the view reflects
    // the just-written image (the session payload may still carry the old one).
    return this.view(userId);
  }

  /** Remove the profile image (null on the auth user row) + fresh view. */
  async clearImage(userId: string): Promise<ProfileView> {
    await this.updateUserColumns(userId, { image: null });
    return this.view(userId);
  }

  private async updateUserColumns(
    userId: string,
    columns: { image: string | null },
  ): Promise<void> {
    const db = this.authDb();
    if (!db) throw new ServiceUnavailableException('auth database is not available');
    try {
      await db
        .updateTable('user')
        .set({ image: columns.image, updatedAt: new Date() })
        .where('id', '=', userId)
        .execute();
    } catch (e) {
      throw new ServiceUnavailableException(
        `could not update profile image: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Claim a custom nickname — 409 when taken by ANOTHER user. */
  async update(userId: string, dto: UpdateProfileDto): Promise<ProfileView> {
    const current = await this.getOrCreate(userId);
    if (dto.nickname === current.nickname) return this.view(userId); // idempotent
    const repo = await this.repo();
    try {
      await repo.update(
        { userId },
        { nickname: dto.nickname, updatedAt: new Date() },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`nickname "${dto.nickname}" is already taken`);
      }
      throw error;
    }
    return this.view(userId);
  }

  /** Discard the current handle, auto-generate a fresh unique one. */
  async rotate(userId: string): Promise<ProfileView> {
    await this.getOrCreate(userId);
    const repo = await this.repo();
    for (let attempt = 0; attempt < NICKNAME_ATTEMPTS; attempt++) {
      try {
        await repo.update(
          { userId },
          { nickname: generateNickname(), updatedAt: new Date() },
        );
        return await this.view(userId);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // nickname collision → another random draw
      }
    }
    throw new ConflictException('could not allocate a unique nickname');
  }
}
