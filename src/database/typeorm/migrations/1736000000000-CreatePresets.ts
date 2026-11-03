import { MigrationInterface, QueryRunner } from 'typeorm';

/** Domain-table migration: user presets (TypeORM-owned, PRD D2 contract). */
export class CreatePresets1736000000000 implements MigrationInterface {
  name = 'CreatePresets1736000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "preset" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "name" text NOT NULL,
        "language" text NOT NULL,
        "data" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_preset" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_preset_user_id" ON "preset" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_preset_user_created_at" ON "preset" ("user_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_preset_user_name" ON "preset" ("user_id", "name");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_preset_user_language" ON "preset" ("user_id", "language");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "preset";`);
  }
}
