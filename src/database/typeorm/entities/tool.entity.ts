import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * DOMAIN table: user tools (TypeORM-owned, PRD D2). References BetterAuth
 * users via a PLAIN string `user_id` — never a FK — because the auth schema
 * belongs to BetterAuth.
 */
@Entity('tool')
@Index('idx_tool_user_id', ['userId'])
@Index('idx_tool_user_created_at', ['userId', 'createdAt'])
@Index('idx_tool_user_name', ['userId', 'name'])
export class Tool {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'download_link', type: 'text' })
  downloadLink!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
