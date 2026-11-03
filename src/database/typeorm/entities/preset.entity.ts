import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * DOMAIN table: user presets (TypeORM-owned, PRD D2). References BetterAuth
 * users via a PLAIN string `user_id` — never a FK — because the auth schema
 * belongs to BetterAuth.
 */
@Entity('preset')
@Index('idx_preset_user_id', ['userId'])
@Index('idx_preset_user_created_at', ['userId', 'createdAt'])
@Index('idx_preset_user_name', ['userId', 'name'])
@Index('idx_preset_user_language', ['userId', 'language'])
export class Preset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  name!: string;

  /** Preset language hint, e.g. "css", "javascript", "html". */
  @Column({ type: 'text' })
  language!: string;

  /**
   * The code itself. Stored as exact text — no trimming, no reformatting:
   * whitespace, line breaks and special characters are preserved verbatim.
   */
  @Column({ type: 'text' })
  data!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
