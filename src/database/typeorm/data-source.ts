import { DataSource } from 'typeorm';

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
  entities: ['src/database/typeorm/entities/**/*.entity.ts'],
  migrations: ['src/database/typeorm/migrations/*.ts'],
  synchronize: false,
  logging: false,
});
