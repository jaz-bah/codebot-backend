import { MigrationInterface, QueryRunner } from 'typeorm';

/** Domain-table migration: user todos (TypeORM-owned, PRD D2 contract). */
export class CreateTodos1731000000000 implements MigrationInterface {
  name = 'CreateTodos1731000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "todo" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "title" text NOT NULL,
        "description" text NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "priority" varchar(20) NOT NULL DEFAULT 'medium',
        "due_date" timestamptz NULL,
        "position" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_todo" PRIMARY KEY ("id"),
        CONSTRAINT "ck_todo_status" CHECK ("status" IN ('pending', 'in_progress', 'done')),
        CONSTRAINT "ck_todo_priority" CHECK ("priority" IN ('low', 'medium', 'high', 'urgent'))
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_todo_user_id" ON "todo" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_todo_user_position" ON "todo" ("user_id", "position");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_todo_user_status" ON "todo" ("user_id", "status");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_todo_user_priority" ON "todo" ("user_id", "priority");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_todo_user_due_date" ON "todo" ("user_id", "due_date");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_todo_user_created_at" ON "todo" ("user_id", "created_at");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "todo";`);
  }
}
