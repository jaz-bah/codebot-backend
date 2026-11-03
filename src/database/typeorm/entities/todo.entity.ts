import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const TODO_STATUSES = ['pending', 'in_progress', 'done'] as const;
export const TODO_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

/**
 * DOMAIN table: user todos (TypeORM-owned, PRD D2). References BetterAuth
 * users via a PLAIN string `user_id` — never a FK — because the auth schema
 * belongs to BetterAuth.
 *
 * `position` is a per-user manual ordering rank (0-based, gap-free). It is
 * compacted inside DB transactions on create/delete/reorder so pagination and
 * manual sorting stay stable.
 */
@Entity('todo')
@Index('idx_todo_user_id', ['userId'])
@Index('idx_todo_user_position', ['userId', 'position'])
@Index('idx_todo_user_status', ['userId', 'status'])
@Index('idx_todo_user_priority', ['userId', 'priority'])
@Index('idx_todo_user_due_date', ['userId', 'dueDate'])
@Index('idx_todo_user_created_at', ['userId', 'createdAt'])
export class Todo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: TodoStatus;

  @Column({ type: 'varchar', length: 20, default: 'medium' })
  priority!: TodoPriority;

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate!: Date | null;

  /** Per-user manual ordering rank (0-based, gap-free). */
  @Column({ type: 'integer', default: 0 })
  position!: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
