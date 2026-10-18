import { DataSource } from 'typeorm';
import { join } from 'path';

/**
 * TypeORM DataSource for DOMAIN tables only (PRD decision D2).
 * Auth tables are BetterAuth/Kysely-owned — never add them here.
 * Domain entities reference user ids as plain strings, no FK.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? '',
  ssl:
    process.env.DATABASE_URL?.includes('localhost') ||
    process.env.DATABASE_URL?.includes('127.0.0.1')
      ? undefined
      : { rejectUnauthorized: false },
  // Works both from src (ts-node) and dist (compiled) layouts.
  entities: [join(__dirname, '**', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations', '*{.ts,.js}')],
  synchronize: false,
  logging: false,
});
