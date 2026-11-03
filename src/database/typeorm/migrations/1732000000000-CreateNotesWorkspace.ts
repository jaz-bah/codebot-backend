import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Domain-table migration: workspace file tree + notes (PRD D2 contract).
 *
 * - `workspace_file`: folders and HTML note files in one self-referencing tree
 *   (nested folders via `parent_id`, FK ON DELETE CASCADE).
 * - `note`: rich HTML content, 1:1 with a file row (unique `file_id`, FK
 *   ON DELETE CASCADE); `user_id` denormalized for ownership scoping.
 *
 * Sibling-name uniqueness is case-insensitive per user and per parent. Because
 * Postgres UNIQUE treats NULLs as distinct, root rows coalesce `parent_id` to
 * a sentinel uuid inside the expression index.
 */
export class CreateNotesWorkspace1732000000000 implements MigrationInterface {
  name = 'CreateNotesWorkspace1732000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_file" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "name" text NOT NULL,
        "type" varchar(10) NOT NULL,
        "parent_id" uuid NULL,
        "position" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workspace_file" PRIMARY KEY ("id"),
        CONSTRAINT "ck_workspace_file_type" CHECK ("type" IN ('folder', 'file')),
        CONSTRAINT "ck_workspace_file_name" CHECK (
          length(btrim("name")) > 0
          AND "name" NOT IN ('.', '..')
          AND strpos("name", '/') = 0
          AND strpos("name", chr(92)) = 0
        ),
        CONSTRAINT "fk_workspace_file_parent" FOREIGN KEY ("parent_id")
          REFERENCES "workspace_file" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_workspace_file_user_id" ON "workspace_file" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_workspace_file_user_parent" ON "workspace_file" ("user_id", "parent_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_workspace_file_user_position" ON "workspace_file" ("user_id", "position");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_workspace_file_user_updated_at" ON "workspace_file" ("user_id", "updated_at");`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_workspace_file_sibling_name"
        ON "workspace_file" (
          "user_id",
          COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),
          lower("name")
        );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "note" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "file_id" uuid NOT NULL,
        "user_id" text NOT NULL,
        "content" text NOT NULL DEFAULT '',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_note" PRIMARY KEY ("id"),
        CONSTRAINT "uq_note_file_id" UNIQUE ("file_id"),
        CONSTRAINT "fk_note_file" FOREIGN KEY ("file_id")
          REFERENCES "workspace_file" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_note_user_id" ON "note" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_note_user_updated_at" ON "note" ("user_id", "updated_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_note_user_created_at" ON "note" ("user_id", "created_at");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "note";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_file";`);
  }
}
