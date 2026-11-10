import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * DOMAIN table: artboard design content (TypeORM-owned, PRD D2). References
 * BetterAuth users via a PLAIN string `user_id` — never a FK — because the
 * auth schema belongs to BetterAuth.
 *
 * `content` is stored VERBATIM (size-capped) — JSON, HTML, markdown, line
 * breaks and special characters must survive round-trips byte-exactly. The
 * backend never interprets or sanitizes it — rendering is the client's
 * responsibility.
 */
@Entity('artboard')
@Index('idx_artboard_user_id', ['userId'])
@Index('idx_artboard_user_created_at', ['userId', 'createdAt'])
@Index('idx_artboard_user_updated_at', ['userId', 'updatedAt'])
@Index('idx_artboard_user_title', ['userId', 'title'])
export class Artboard {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  title!: string;

  /** Raw artboard payload, stored exactly as submitted. */
  @Column({ type: 'text', default: '' })
  content!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
