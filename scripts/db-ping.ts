/**
 * Connectivity check for both database layers. Run with a real DATABASE_URL:
 *   npm run db:ping
 *
 * Note: env must be loaded BEFORE importing the data source (module-level
 * code reads process.env.DATABASE_URL), hence dynamic imports below.
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

loadEnv({ path: resolve(process.cwd(), '.env') });

async function main(): Promise<void> {
  const { Client } = await import('pg');
  const { createKyselyPool } = await import('../src/database/kysely/pool');
  const { sslFromUrl } = await import('../src/database/ssl');
  const { AppDataSource } = await import('../src/database/typeorm/data-source');

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  // Layer 1: raw pg client
  const client = new Client({
    connectionString: url,
    ssl: sslFromUrl(url) || undefined,
  });
  await client.connect();
  const raw = await client.query<{ one: number }>('select 1 as one');
  console.log(`[pg]       select 1 → ${raw.rows[0].one}`);
  await client.end();

  // Layer 2: Kysely (BetterAuth's layer) — auth tables may not exist yet
  const db = createKyselyPool(url);
  try {
    await db.selectFrom('user').selectAll().limit(1).execute();
    console.log('[kysely]   auth-table query → ok');
  } catch {
    console.log('[kysely]   connected (auth tables not created yet — expected in Phase 0 pre-migrate)');
  }
  await db.destroy();

  // Layer 3: TypeORM (domain layer)
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  const typeormResult = await AppDataSource.query('select 1 as one');
  console.log(`[typeorm]  select 1 → ${typeormResult[0].one}`);
  await AppDataSource.destroy();

  console.log('DB PING OK — all layers connected');
}

void main().catch((err) => {
  console.error('DB PING FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
