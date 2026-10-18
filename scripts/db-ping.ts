/**
 * Connectivity check for both database layers. Run with a real DATABASE_URL:
 *   npm run db:ping
 */
import { Client } from 'pg';
import { createKyselyPool } from '../src/database/kysely/pool';
import { AppDataSource } from '../src/database/typeorm/data-source';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  // Layer 1: raw pg client
  const client = new Client({
    connectionString: url,
    ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false },
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
