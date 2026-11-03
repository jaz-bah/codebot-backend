import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const WORKSPACE_FILE_TYPES = ['folder', 'file'] as const;

export type WorkspaceFileType = (typeof WORKSPACE_FILE_TYPES)[number];

/**
 * DOMAIN table: workspace file tree (PRD D2). References BetterAuth users via
 * a PLAIN string `user_id` — never a FK — because the auth schema belongs to
 * BetterAuth.
 *
 * A row is either a `folder` (container) or a `file` (an HTML note document).
 * `parent_id` is a self-reference (FK created by migration, ON DELETE CASCADE)
 * so nested folders are supported; `parent_id IS NULL` means workspace root.
 *
 * `position` is a per-folder manual ordering rank (0-based, gap-free among
 * siblings) — compacted inside DB transactions on create/delete/move so the
 * file explorer keeps a stable drag-and-drop order.
 *
 * Uniqueness: sibling names are unique per user (case-insensitive) via the
 * expression index `uq_workspace_file_sibling_name` (root rows use a sentinel
 * because Postgres UNIQUE treats NULLs as distinct).
 */
@Entity('workspace_file')
@Index('idx_workspace_file_user_id', ['userId'])
@Index('idx_workspace_file_user_parent', ['userId', 'parentId'])
@Index('idx_workspace_file_user_position', ['userId', 'position'])
@Index('idx_workspace_file_user_updated_at', ['userId', 'updatedAt'])
export class WorkspaceFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  /** Display name. Folders: any text; files: must end with `.html`. */
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'varchar', length: 10 })
  type!: WorkspaceFileType;

  /** Self-reference to the containing folder (NULL = workspace root). */
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  /** Manual ordering rank among siblings (0-based, gap-free). */
  @Column({ type: 'integer', default: 0 })
  position!: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

/** Shape returned by `FilesService.tree()` — the workspace explorer payload. */
export interface WorkspaceFileNode {
  id: string;
  name: string;
  type: WorkspaceFileType;
  parentId: string | null;
  position: number;
  children: WorkspaceFileNode[];
}
