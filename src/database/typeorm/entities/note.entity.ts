import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * DOMAIN table: rich HTML note content (PRD D2). 1:1 with a `workspace_file`
 * row of type `file` (unique `file_id`, FK ON DELETE CASCADE — deleting the
 * file removes its note). `user_id` is denormalized from the file row so every
 * note query can scope ownership WITHOUT an extra join (files never change
 * owner, so the copy cannot drift).
 *
 * Content is rich HTML produced by the editor. The backend stores it verbatim
 * (size-capped) and never executes it — rendering/sanitization is the
 * client's responsibility.
 */
@Entity('note')
@Index('idx_note_user_id', ['userId'])
@Index('idx_note_user_updated_at', ['userId', 'updatedAt'])
@Index('idx_note_user_created_at', ['userId', 'createdAt'])
export class Note {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Owning workspace file (unique FK, cascade-deleted with the file). */
  @Column({ name: 'file_id', type: 'uuid' })
  fileId!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2; mirrors the file row). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  /** Rich HTML document body. */
  @Column({ type: 'text', default: '' })
  content!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
