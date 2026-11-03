import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * DOMAIN table: one code file of a component (PRD D2). Owned by a `component`
 * row — `component_id` is the UUID FK (created by the migration,
 * ON DELETE CASCADE); `user_id` is DENORMALIZED from the component row (exact
 * same trick as the `note` table) so ownership-scoped file queries never need
 * a join, and language filtering works without touching the parent.
 *
 * `code` is stored VERBATIM — the backend never trims or reformats it
 * (whitespace/indentation is preserved exactly); size-capped only.
 *
 * `position` is a per-component insertion rank (0-based) — `created_at` is
 * identical for every file written in one transaction (`now()`), so without
 * this column read queries could not reproduce the payload order.
 */
@Entity('component_file')
@Index('idx_component_file_component_id', ['componentId'])
@Index('idx_component_file_component_position', ['componentId', 'position'])
@Index('idx_component_file_user_id', ['userId'])
@Index('idx_component_file_user_language', ['userId', 'language'])
export class ComponentFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Owning component (FK ON DELETE CASCADE — created in the migration). */
  @Column({ name: 'component_id', type: 'uuid' })
  componentId!: string;

  /** BetterAuth user id (plain string, mirrors the component row). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  /** Lowercase short language tag (css, html, js, ts, json, svg…). */
  @Column({ type: 'varchar', length: 20 })
  language!: string;

  /** Source code, stored byte-for-byte as sent (no trim/reformat). */
  @Column({ type: 'text' })
  code!: string;

  /** Insertion rank among the component's files (0-based, stable read order). */
  @Column({ type: 'integer', default: 0 })
  position!: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
