import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * DOMAIN table: 1:1 chat conversation (TypeORM-owned, PRD D2). Participants
 * reference BetterAuth users via PLAIN string ids — never a FK — because the
 * auth schema belongs to BetterAuth.
 *
 * The pair is canonically ordered in `user_a_id` / `user_b_id` (always
 * `user_a_id < user_b_id`) so a plain UNIQUE index prevents duplicate
 * conversations between the same two users. The CHECK constraint additionally
 * forbids self-conversations and lets the query planner trust the canonical
 * order. Ordering two TEXT ids in SQL: `LEAST`/`GREATEST` (application code
 * compares ids lexically the same way before writing).
 */
@Entity('conversation')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Lexicographically smaller participant (BetterAuth user id, no FK — PRD D2). */
  @Column({ name: 'user_a_id', type: 'text' })
  userAId!: string;

  /** Lexicographically larger participant (BetterAuth user id, no FK — PRD D2). */
  @Column({ name: 'user_b_id', type: 'text' })
  userBId!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  /**
   * Last-activity stamp: bumped to `now()` on every message send (the list is
   * ordered by it). Kept on the DATABASE clock so client clocks cannot skew it.
   */
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
