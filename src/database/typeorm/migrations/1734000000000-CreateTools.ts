import { MigrationInterface, QueryRunner } from 'typeorm';

/** Domain-table migration: user tools (TypeORM-owned, PRD D2 contract). */
export class CreateTools1734000000000 implements MigrationInterface {
  name = 'CreateTools1734000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tool" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "name" text NOT NULL,
        "description" text NULL,
        "download_link" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tool" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_tool_user_id" ON "tool" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_tool_user_created_at" ON "tool" ("user_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_tool_user_name" ON "tool" ("user_id", "name");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tool";`);
  }
}
