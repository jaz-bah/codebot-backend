import { MigrationInterface, QueryRunner } from 'typeorm';

/** First domain-table migration: audit_log (PRD D2 contract). */
export class CreateAuditLog1729000000000 implements MigrationInterface {
  name = 'CreateAuditLog1729000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NULL,
        "email" text NULL,
        "action" text NOT NULL,
        "detail" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_audit_log" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_audit_log_user_id" ON "audit_log" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_audit_log_created_at" ON "audit_log" ("created_at");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_log";`);
  }
}
