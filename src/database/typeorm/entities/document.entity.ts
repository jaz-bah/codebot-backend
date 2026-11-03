import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * DOMAIN table: user documents (TypeORM-owned, PRD D2). References BetterAuth
 * users via a PLAIN string `user_id` — never a FK — because the auth schema
 * belongs to BetterAuth.
 *
 * A document is one uploaded file + its user-editable metadata: a `name`, an
 * optional `description`, and the Cloudinary `url` the bytes live at (the
 * user's own Cloudinary account — see the uploads module). Binary content is
 * NEVER stored in our database; deleting the row does not delete the asset.
 */
@Entity('document')
@Index('idx_document_user_id', ['userId'])
@Index('idx_document_user_created_at', ['userId', 'createdAt'])
@Index('idx_document_user_updated_at', ['userId', 'updatedAt'])
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  /** Display name; defaults to the sanitized original filename on create. */
  @Column({ type: 'text' })
  name!: string;

  /** Free-form user context for the file (up to 5000 chars, optional). */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Secure Cloudinary URL of the uploaded asset. */
  @Column({ type: 'text' })
  url!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
