import { MigrationInterface, QueryRunner } from 'typeorm';

/** Domain-table migration: user profiles (nickname) — TypeORM-owned, PRD D2. */
export class CreateProfiles1740000000000 implements MigrationInterface {
  name = 'CreateProfiles1740000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "profile" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "nickname" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_profile" PRIMARY KEY ("id")
      );
    `);
    // Globally single profile per user + globally unique nickname.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_profile_user_id" ON "profile" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_profile_nickname" ON "profile" ("nickname");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "profile";`);
  }
}
