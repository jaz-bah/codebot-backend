import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Domain-table migration: PUBLIC posts + one-vote-per-user upvotes (PRD
 * decision D2 contract).
 *
 * - `post`: a share-point over an EXISTING resource — title/description live
 *   on the post, the resource's data is never copied. `user_id` references
 *   BetterAuth users as a PLAIN string (no FK — the auth schema belongs to
 *   BetterAuth). UNIQUE (resource_type, resource_id) guarantees one post per
 *   resource.
 * - `post_vote`: composite PRIMARY KEY (post_id, user_id) makes duplicate
 *   votes impossible at the DB level; FK ON DELETE CASCADE keeps votes
 *   consistent when a post is un-published.
 */
export class CreatePosts1742000000000 implements MigrationInterface {
  name = 'CreatePosts1742000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "post" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "resource_type" varchar(20) NOT NULL,
        "resource_id" uuid NOT NULL,
        "title" text NOT NULL,
        "description" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_post" PRIMARY KEY ("id"),
        CONSTRAINT "ck_post_title" CHECK (length(btrim("title")) > 0),
        CONSTRAINT "ck_post_resource_type" CHECK ("resource_type" IN ('todo', 'note', 'component', 'preset', 'tool', 'snippet'))
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_post_resource" ON "post" ("resource_type", "resource_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_post_user_id" ON "post" ("user_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_post_user_created_at" ON "post" ("user_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_post_created_at" ON "post" ("created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_post_resource_created_at" ON "post" ("resource_type", "created_at");`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "post_vote" (
        "post_id" uuid NOT NULL,
        "user_id" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_post_vote" PRIMARY KEY ("post_id", "user_id"),
        CONSTRAINT "fk_post_vote_post" FOREIGN KEY ("post_id")
          REFERENCES "post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_post_vote_user_id" ON "post_vote" ("user_id");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "post_vote";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "post";`);
  }
}
