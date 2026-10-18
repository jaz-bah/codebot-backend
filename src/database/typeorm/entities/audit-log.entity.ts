import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * First DOMAIN table (PRD D2): domain tables are TypeORM-owned and reference
 * BetterAuth users via a PLAIN string `user_id` — never a FK — because the
 * auth schema belongs to BetterAuth.
 */
@Entity('audit_log')
@Index('idx_audit_log_user_id', ['userId'])
@Index('idx_audit_log_created_at', ['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2). Nullable for system events. */
  @Column({ name: 'user_id', type: 'text', nullable: true })
  userId!: string | null;

  @Column({ name: 'email', type: 'text', nullable: true })
  email!: string | null;

  /** e.g. ACCESS_DENIED, PASSWORD_RESET, OAUTH_LINK_DENIED… */
  @Column({ name: 'action', type: 'text' })
  action!: string;

  /** Structured, secret-free context. */
  @Column({ name: 'detail', type: 'jsonb', nullable: true })
  detail!: Record<string, unknown> | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
