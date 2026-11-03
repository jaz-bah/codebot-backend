import { MigrationInterface, QueryRunner } from 'typeorm';

/** Domain-table migration: user documents (TypeORM-owned, PRD D2 contract). */
export class CreateDocuments1738000000000 implements MigrationInterface {
  name = 'CreateDocuments1738000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "document" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "name" text NOT NULL,
        "description" text NULL,
        "url" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_document" PRIMARY KEY ("id"),
        CONSTRAINT "ck_document_url_https" CHECK ("url" LIKE 'https://%')
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_document_user_id" ON "document" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_document_user_created_at" ON "document" ("user_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_document_user_updated_at" ON "document" ("user_id", "updated_at");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "document";`);
  }
}
