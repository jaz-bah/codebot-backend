import { MigrationInterface, QueryRunner } from 'typeorm';

/** Domain-table migration: user components + their code files (PRD D2). */
export class CreateComponents1739000000000 implements MigrationInterface {
  name = 'CreateComponents1739000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "component" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "name" text NOT NULL,
        "preview" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_component" PRIMARY KEY ("id")
      );
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "component_file" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "component_id" uuid NOT NULL,
        "user_id" text NOT NULL,
        "language" varchar(20) NOT NULL,
        "code" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_component_file" PRIMARY KEY ("id"),
        CONSTRAINT "fk_component_file_component"
          FOREIGN KEY ("component_id") REFERENCES "component" ("id") ON DELETE CASCADE,
        CONSTRAINT "ck_component_file_language" CHECK ("language" ~ '^[a-z0-9_-]{1,20}$')
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_component_user_id" ON "component" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_component_user_created_at" ON "component" ("user_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_component_user_updated_at" ON "component" ("user_id", "updated_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_component_file_component_id" ON "component_file" ("component_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_component_file_user_id" ON "component_file" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_component_file_user_language" ON "component_file" ("user_id", "language");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "component_file";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "component";`);
  }
}
