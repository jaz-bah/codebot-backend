import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Every resource kind that can be published as a public post. */
export const POST_RESOURCE_TYPES = ['todo', 'note', 'component', 'preset', 'tool', 'snippet'] as const;
export type PostResourceType = (typeof POST_RESOURCE_TYPES)[number];

/** Human labels used in error messages (resource_type → "Note"…). */
export const POST_RESOURCE_LABELS: Record<PostResourceType, string> = {
  todo: 'Todo',
  note: 'Note',
  component: 'Component',
  preset: 'Preset',
  tool: 'Tool',
  snippet: 'IDE snippet',
};

/**
 * DOMAIN table: PUBLIC share-point for existing resources (PRD D2). The post
 * itself carries ONLY presentation metadata (title/description) — the
 * resource's own row is never copied, the post points at it via
 * (`resource_type`, `resource_id`). `user_id` is a PLAIN string reference to
 * BetterAuth users — never a FK — because the auth schema belongs to
 * BetterAuth.
 *
 * `uq_post_resource` guarantees one post per resource and
 * `fk_post_vote_post` (post_vote migration) cascades an upvote's removal with
 * its post, so un-publishing always cleans up fully.
 */
@Entity('post')
@Index('idx_post_user_id', ['userId'])
@Index('idx_post_user_created_at', ['userId', 'createdAt'])
@Index('idx_post_created_at', ['createdAt'])
@Index('idx_post_resource_created_at', ['resourceType', 'createdAt'])
@Index('uq_post_resource', ['resourceType', 'resourceId'], { unique: true })
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Post owner = resource owner (BetterAuth user id, plain string, no FK). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  /** Which resource table the post points at. */
  @Column({ name: 'resource_type', type: 'varchar', length: 20 })
  resourceType!: PostResourceType;

  /** The resource's own PK (uuid in every resource table; notes → file id). */
  @Column({ name: 'resource_id', type: 'uuid' })
  resourceId!: string;

  /** Public display title (post-specific — resource data is NOT duplicated). */
  @Column({ type: 'text' })
  title!: string;

  /** Optional public description (post-specific). */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
