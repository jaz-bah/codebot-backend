import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { sslFromUrl } from '../ssl';

/**
 * Dev-facing typed handle over the BetterAuth-owned tables.
 *
 * NOTE: the BetterAuth Kysely adapter owns these tables' SCHEMA and lifecycle
 * (PRD D1/D2) — never write from TypeORM and never alter columns here. This
 * interface exists so read-only stats/promotion queries can be typed: the keys
 * MUST match the real DB columns (camelCase, see docs/schema/…sql).
 */
export interface AuthBaseDB {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    username: string | null;
    createdAt: Date;
    updatedAt: Date;
  } & Record<string, unknown>;
  session: {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
  } & Record<string, unknown>;
  account: { id: string; userId: string; providerId: string; accountId: string } & Record<string, unknown>;
}

const poolCache = new Map<string, Kysely<AuthBaseDB>>();

/**
 * Memoized pool for OUR read queries (admin stats / promotion). Reusing one
 * Kysely instance avoids pg Pool leaks across module factories. Never call
 * `.destroy()` on the returned instance — it is shared.
 */
export function getAuthKysely(databaseUrl: string): Kysely<AuthBaseDB> {
  const existing = poolCache.get(databaseUrl);
  if (existing) return existing;
  const created = new Kysely<AuthBaseDB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: databaseUrl,
        max: 5,
        ssl: sslFromUrl(databaseUrl) || undefined,
      }),
    }),
  });
  poolCache.set(databaseUrl, created);
  return created;
}
