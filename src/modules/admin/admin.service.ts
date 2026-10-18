import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AuthBaseDB } from '../../database/kysely/auth-db';

/**
 * ADMIN_DB token lives here so only this module yields the shared, read-only
 * Kysely handle over BetterAuth-owned tables.
 */
export const ADMIN_DB = 'ADMIN_DB';

export interface AdminStats {
  users: number;
  verifiedUsers: number;
  activeSessions: number;
  signups30d: number;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string | null;
  emailVerified: boolean;
  createdAt: Date;
  sessionCount: number;
}

const cast = (v: unknown): number => Number(v ?? 0);

/**
 * READ-ONLY analytics over BetterAuth-owned tables (PRD D2: the domain side
 * may read auth tables but never write/migrate them).
 */
@Injectable()
export class AdminService {
  constructor(@Inject(ADMIN_DB) private readonly db: Kysely<AuthBaseDB>) {}

  async stats(): Promise<AdminStats> {
    const [userStats, sessionStats] = await Promise.all([
      this.db
        .selectFrom('user')
        .select((eb) => [
          eb.fn.countAll().as('users'),
          eb.fn.count('id').filterWhere('emailVerified', '=', true).as('verifiedUsers'),
          eb.fn
            .count('id')
            .filterWhere('createdAt', '>', new Date(Date.now() - 30 * 24 * 3600 * 1000))
            .as('signups30d'),
        ])
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('session')
        .select((eb) => eb.fn.count('id').as('activeSessions'))
        .where('expiresAt', '>', new Date())
        .executeTakeFirstOrThrow(),
    ]);

    return {
      users: cast(userStats.users),
      verifiedUsers: cast(userStats.verifiedUsers),
      signups30d: cast(userStats.signups30d),
      activeSessions: cast(sessionStats.activeSessions),
    };
  }

  async listUsers(
    page = 1,
    limit = 20,
  ): Promise<{ items: AdminUserRow[]; total: number; page: number; limit: number }> {
    const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    const [rows, totalRow] = await Promise.all([
      this.db
        .selectFrom('user')
        .leftJoin('session', (join) => join.on('session.userId', '=', 'user.id'))
        .select((eb) => [
          'user.id as id',
          'user.name as name',
          'user.email as email',
          'user.role as role',
          'user.emailVerified as emailVerified',
          'user.createdAt as createdAt',
          eb.fn.count('session.id').as('sessionCount'),
        ])
        .groupBy([
          'user.id',
          'user.name',
          'user.email',
          'user.role',
          'user.emailVerified',
          'user.createdAt',
        ])
        .orderBy('user.createdAt', 'desc')
        .limit(safeLimit)
        .offset(offset)
        .execute(),
      this.db
        .selectFrom('user')
        .select((eb) => eb.fn.countAll().as('total'))
        .executeTakeFirstOrThrow(),
    ]);

    return {
      items: rows.map((r) => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: String(r.id),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name: String(r.name),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        email: String(r.email),
        role: r.role == null ? null : String(r.role),
        emailVerified: Boolean(r.emailVerified),
        createdAt: new Date(r.createdAt as never),
        sessionCount: cast(r.sessionCount),
      })),
      total: cast(totalRow.total),
      page: safePage,
      limit: safeLimit,
    };
  }

  /** Stats for a single user or NotFound (used by admin detail endpoints later). */
  async userById(id: string): Promise<AdminUserRow | undefined> {
    const row = await this.db
      .selectFrom('user')
      .leftJoin('session', 'session.userId', 'user.id')
      .select((eb) => [
        'user.id as id',
        'user.name as name',
        'user.email as email',
        'user.role as role',
        'user.emailVerified as emailVerified',
        'user.createdAt as createdAt',
        eb.fn.count('session.id').as('sessionCount'),
      ])
      .groupBy([
        'user.id',
        'user.name',
        'user.email',
        'user.role',
        'user.emailVerified',
        'user.createdAt',
      ])
      .where('user.id', '=', id)
      .executeTakeFirst();
    if (!row) return undefined;
    return {
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      role: row.role == null ? null : String(row.role),
      emailVerified: Boolean(row.emailVerified),
      createdAt: new Date(row.createdAt as never),
      sessionCount: cast(row.sessionCount),
    };
  }
}
