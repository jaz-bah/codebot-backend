import { MigrationInterface, QueryRunner } from 'typeorm';

/** Domain-table migration: per-user settings (TypeORM-owned, PRD D2). */
export class CreateSettings1737000000000 implements MigrationInterface {
  name = 'CreateSettings1737000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "setting" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "open_router_api_key" text NULL,
        "cloudinary_cloud_name" text NULL,
        "cloudinary_api_key" text NULL,
        "cloudinary_api_secret" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_setting" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_setting_user_id" ON "setting" ("user_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "setting";`);
  }
}
