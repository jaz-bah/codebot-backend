import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * IDE snippets are JSON files now: the create dialog asks for a FILE NAME
 * (e.g. "en.default.json") and the language is always "json". The file name
 * lives in its own nullable column — legacy rows keep their language label
 * as the display fallback.
 */
export class AddIdeSnippetFileName1744000000000 implements MigrationInterface {
  name = 'AddIdeSnippetFileName1744000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ide_snippet" ADD COLUMN IF NOT EXISTS "file_name" text;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ide_snippet" DROP COLUMN IF EXISTS "file_name";`,
    );
  }
}
