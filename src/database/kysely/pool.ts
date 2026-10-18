import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { sslFromUrl } from '../ssl';
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

/** Pool for the BetterAuth Kysely adapter (Neon pooled URL, SSL-aware). */
export function createKyselyPool(databaseUrl: string): Kysely<AuthSchema> {
  return new Kysely<AuthSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: databaseUrl,
        max: 5,
        ssl: sslFromUrl(databaseUrl) || undefined,
      }),
    }),
  });
}
