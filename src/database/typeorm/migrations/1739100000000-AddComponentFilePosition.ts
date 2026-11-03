import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Follow-up to CreateComponents1739000000000: files written in ONE
 * transaction share the same `created_at` (`now()`), so insertion order was
 * not reproducible on reads. Alias `position` keeps the exact payload order
 * (0-based per component) — same pattern as todos/workspace files.
 */
export class AddComponentFilePosition1739100000000 implements MigrationInterface {
  name = 'AddComponentFilePosition1739100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "component_file"
        ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0;
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_component_file_component_position" ON "component_file" ("component_id", "position");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_component_file_component_position";`,
    );
    await queryRunner.query(`ALTER TABLE "component_file" DROP COLUMN IF EXISTS "position";`);
  }
}
