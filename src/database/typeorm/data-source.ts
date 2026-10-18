import { DataSource } from 'typeorm';
import { join } from 'path';
import { sslFromUrl } from '../ssl';

/**
 * TypeORM DataSource for DOMAIN tables only (PRD decision D2).
 * Auth tables are BetterAuth/Kysely-owned — never add them here.
 *
 * Connection fields are parsed from DATABASE_URL explicitly because TypeORM's
 * URL parser is stricter than `pg`'s (fails on some passwords in SASL).
 * Domain entities reference user ids as plain strings, no FK.
 */
const fromUrl = (url: string): Record<string, unknown> => {
  if (!url) return {};
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      username: decodeURIComponent(u.username || 'postgres'),
      password: decodeURIComponent(u.password ?? ''),
      database: decodeURIComponent(u.pathname.replace(/^\//, '').split('?')[0] || 'postgres'),
    };
  } catch {
    return { url }; // fall back to raw url if it is not a standard URL
  }
};

const DATABASE_URL = process.env.DATABASE_URL ?? '';

export const AppDataSource = new DataSource({
  type: 'postgres',
  ...fromUrl(DATABASE_URL),
  ssl: sslFromUrl(DATABASE_URL) || undefined,
  // Works both from src (ts-node) and dist (compiled) layouts.
  entities: [join(__dirname, '**', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
  synchronize: false,
  logging: false,
});
