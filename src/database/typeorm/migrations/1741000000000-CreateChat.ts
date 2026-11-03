import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Domain-table migration: 1:1 chat (PRD D2 contract).
 *
 * - `conversation`: canonically ordered participant pair (`user_a_id <
 *   user_b_id`) + UNIQUE pair index → duplicate conversations between the same
 *   two users are impossible at the DB level. `updated_at` is the
 *   last-activity stamp (bumped by ChatService on every message).
 * - `message`: content + sender + read flag; FK ON DELETE CASCADE to its
 *   conversation. sender_id references BetterAuth users as a PLAIN string (no
 *   FK — the auth schema belongs to BetterAuth).
 */
export class CreateChat1741000000000 implements MigrationInterface {
  name = 'CreateChat1741000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversation" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_a_id" text NOT NULL,
        "user_b_id" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_conversation" PRIMARY KEY ("id"),
        CONSTRAINT "ck_conversation_self" CHECK ("user_a_id" <> "user_b_id"),
        CONSTRAINT "ck_conversation_pair_order" CHECK ("user_a_id" < "user_b_id")
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_conversation_pair" ON "conversation" ("user_a_id", "user_b_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_conversation_user_a_id" ON "conversation" ("user_a_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_conversation_user_b_id" ON "conversation" ("user_b_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_conversation_user_a_updated" ON "conversation" ("user_a_id", "updated_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_conversation_user_b_updated" ON "conversation" ("user_b_id", "updated_at");`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "message" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "sender_id" text NOT NULL,
        "content" text NOT NULL,
        "is_read" boolean NOT NULL DEFAULT false,
        "read_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_message" PRIMARY KEY ("id"),
        CONSTRAINT "ck_message_content" CHECK (length(btrim("content")) > 0),
        CONSTRAINT "fk_message_conversation" FOREIGN KEY ("conversation_id")
          REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_message_conversation_created" ON "message" ("conversation_id", "created_at");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_message_sender" ON "message" ("sender_id");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_message_conversation_unread" ON "message" ("conversation_id", "is_read") WHERE "is_read" = false;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "message";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation";`);
  }
}
