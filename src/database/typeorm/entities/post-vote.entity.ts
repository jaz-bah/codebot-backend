import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * DOMAIN table: one upvote per user per post (PRD D2). The COMPOSITE primary
 * key `(post_id, user_id)` makes duplicate votes impossible at the database
 * level; `user_id` is a PLAIN string reference to BetterAuth users — no FK —
 * while `post_id` is a real FK that cascade-deletes with its post, so votes
 * never outlive the post they belong to.
 */
@Entity('post_vote')
@Index('idx_post_vote_user_id', ['userId'])
export class PostVote {
  /** Voted post (real FK, ON DELETE CASCADE). */
  @PrimaryColumn({ name: 'post_id', type: 'uuid' })
  postId!: string;

  /** Voting BetterAuth user id (plain string, no FK — PRD D2). */
  @PrimaryColumn({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
