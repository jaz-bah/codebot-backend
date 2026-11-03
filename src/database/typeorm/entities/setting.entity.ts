import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * DOMAIN table: per-user settings (TypeORM-owned, PRD D2). References
 * BetterAuth users via a PLAIN string `user_id` — never a FK — because the
 * auth schema belongs to BetterAuth.
 *
 * One singleton row per user (unique index on user_id). Secret values
 * (`open_router_api_key`, `cloudinary_api_key`, `cloudinary_api_secret`) are
 * stored AES-256-GCM ENCRYPTED AT REST (see settings-cipher.ts) and are never
 * returned in API responses — GET returns masked previews only.
 * `cloudinary_cloud_name` is not secret and is stored/returned as plain text.
 */
@Entity('setting')
@Index('idx_setting_user_id', ['userId'])
export class Setting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  /** OpenRouter API key — encrypted at rest (`enc:v1:…`). */
  @Column({ name: 'open_router_api_key', type: 'text', nullable: true })
  openRouterApiKey!: string | null;

  /** Cloudinary cloud name — plain text (not a secret). */
  @Column({ name: 'cloudinary_cloud_name', type: 'text', nullable: true })
  cloudinaryCloudName!: string | null;

  /** Cloudinary API key — encrypted at rest (`enc:v1:…`). */
  @Column({ name: 'cloudinary_api_key', type: 'text', nullable: true })
  cloudinaryApiKey!: string | null;

  /** Cloudinary API secret — encrypted at rest (`enc:v1:…`). */
  @Column({ name: 'cloudinary_api_secret', type: 'text', nullable: true })
  cloudinaryApiSecret!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
