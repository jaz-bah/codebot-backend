import { MigrationInterface, QueryRunner } from 'typeorm';

/** Domain-table migration: user IDE snippets (TypeORM-owned, PRD D2 contract). */
export class CreateIdeSnippets1735000000000 implements MigrationInterface {
  name = 'CreateIdeSnippets1735000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ide_snippet" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "language" text NOT NULL,
        "data" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ide_snippet" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ide_snippet_user_id" ON "ide_snippet" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ide_snippet_user_created_at" ON "ide_snippet" ("user_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_ide_snippet_user_language" ON "ide_snippet" ("user_id", "language");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ide_snippet";`);
  }
}
