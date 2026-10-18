import { Kysely, PostgresDialect } from 'kysely';
import { Pool, PoolConfig } from 'pg';

/**
 * The BetterAuth-owned tables. BetterAuth manages this schema via the
 * Kysely adapter + @better-auth/cli — never touch these tables via TypeORM
 * (PRD decision D1/D2).
 */
export interface AuthSchema {
  user: {
    id: string;
    name: string;
    email: string;
    email_verified: number | boolean;
    image: string | null;
    role: string | null;
    created_at: Date;
    updated_at: Date;
  };
  session: {
    id: string;
    expires_at: Date;
    token: string;
    user_id: string;
  };
  account: {
    id: string;
    account_id: string;
    provider_id: string;
    user_id: string;
  };
  verification: {
    id: string;
    identifier: string;
    value: string;
    expires_at: Date;
  };
}

/** Pool for the BetterAuth Kysely adapter (Neon pooled URL, SSL). */
export function createKyselyPool(databaseUrl: string): Kysely<AuthSchema> {
  const poolConfig: PoolConfig = {
    connectionString: databaseUrl,
    max: 5,
    ssl: databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')
      ? undefined
      : { rejectUnauthorized: false },
  };
  return new Kysely<AuthSchema>({
    dialect: new PostgresDialect({ pool: new Pool(poolConfig) }),
  });
}
