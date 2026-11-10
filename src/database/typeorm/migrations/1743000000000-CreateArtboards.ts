import { MigrationInterface, QueryRunner } from 'typeorm';

/** Domain-table migration: user artboards (TypeORM-owned, PRD D2 contract). */
export class CreateArtboards1743000000000 implements MigrationInterface {
  name = 'CreateArtboards1743000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "artboard" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "title" text NOT NULL,
        "content" text NOT NULL DEFAULT '',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_artboard" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_artboard_user_id" ON "artboard" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_artboard_user_created_at" ON "artboard" ("user_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_artboard_user_updated_at" ON "artboard" ("user_id", "updated_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_artboard_user_title" ON "artboard" ("user_id", "title");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "artboard";`);
  }
}
