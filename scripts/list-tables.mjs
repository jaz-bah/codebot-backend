import pg from 'pg';
import 'dotenv/config';

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const r = await c.query(
  "select table_name from information_schema.tables where table_schema='public' order by 1",
);
console.log('tables in public schema:', r.rows.map((x) => x.table_name).join(', ') || '(none)');
await c.end();
