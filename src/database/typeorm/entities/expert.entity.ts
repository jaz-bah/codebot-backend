import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * DOMAIN table: user experts (TypeORM-owned, PRD D2). References BetterAuth
 * users via a PLAIN string `user_id` — never a FK — because the auth schema
 * belongs to BetterAuth.
 */
@Entity('expert')
@Index('idx_expert_user_id', ['userId'])
@Index('idx_expert_user_created_at', ['userId', 'createdAt'])
@Index('idx_expert_user_title', ['userId', 'title'])
export class Expert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
