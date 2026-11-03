import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ComponentFile } from './component-file.entity';

/**
 * DOMAIN table: user UI components (PRD D2). References BetterAuth users via
 * a PLAIN string `user_id` — never a FK — because the auth schema belongs to
 * BetterAuth.
 *
 * A component is a named, preview-ready snippet library entry: a display
 * `name`, a `preview` image (absolute URL or root-relative path) and N code
 * files living in the `component_file` table (FK ON DELETE CASCADE — created
 * in the migration; entity stays flat like every other domain table).
 */
@Entity('component')
@Index('idx_component_user_id', ['userId'])
@Index('idx_component_user_created_at', ['userId', 'createdAt'])
@Index('idx_component_user_updated_at', ['userId', 'updatedAt'])
export class Component {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  /** Display name (1–255 chars, trimmed). Duplicates across components are allowed. */
  @Column({ type: 'text' })
  name!: string;

  /** Absolute URL (https://…) or root-relative path (/…) of the preview image. */
  @Column({ type: 'text' })
  preview!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

/** Shape returned by every component READ — files ordered by insertion. */
export interface ComponentWithFiles extends Component {
  files: ComponentFile[];
}
