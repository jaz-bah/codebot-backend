import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * DOMAIN table: public profile handle (PRD D2). References BetterAuth users
 * via a PLAIN string `user_id` — never a FK — because the auth schema belongs
 * to BetterAuth (the `role` additionalField lives there, but domain data such
 * as this stays TypeORM-owned by contract).
 *
 * Every user has EXACTLY one profile row, created lazily on first access
 * (get-or-create). `nickname` is a short, globally-unique, auto-generated
 * handle ('cb7f3jq' style); it can also be set manually — uniqueness is
 * DB-backed by the unique index `uq_profile_nickname` with a retry loop as
 * the race backstop. Counts are NOT stored — they are computed live per
 * request, so they can never drift from the real rows.
 */
@Entity('profile')
@Index('idx_profile_user_id', ['userId'])
@Index('idx_profile_nickname', ['nickname'])
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** BetterAuth user id (plain string, no FK — PRD D2). */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  /** Short unique handle, 3–24 chars of [a-z0-9_]; unique across ALL users. */
  @Column({ type: 'text' })
  nickname!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}

/** Live content counts per domain (mirrors the search scope inventory). */
export interface ProfileCounts {
  todos: number;
  notes: number;
  files: number;
  folders: number;
  documents: number;
  components: number;
  presets: number;
  experts: number;
  tools: number;
  snippets: number;
}

/**
 * Live content counts per domain (mirrors the search scope inventory).
 * [table, countAlias, extraWhere] — read-only inventory for the profile
 * aggregate query; workspace_file splits folders from actual files.
 */
export const profileCountsKeyedByTable: Array<[table: string, count: string, where: string]> = [
  ['todo', 'todos', ''],
  ['note', 'notes', ''],
  ['workspace_file', 'files', " and \"type\" = 'file'"],
  ['workspace_file', 'folders', " and \"type\" = 'folder'"],
  ['document', 'documents', ''],
  ['component', 'components', ''],
  ['preset', 'presets', ''],
  ['expert', 'experts', ''],
  ['tool', 'tools', ''],
  ['ide_snippet', 'snippets', ''],
];

/**
 * The BetterAuth user block returned inside every profile payload. `image`
 * lives on the auth user row (set via the multipart PATCH /profile/image
 * endpoint); `username` is the unique auto-generated handle.
 */
export interface ProfileUser {
  id: string;
  email: string;
  name: string;
  username: string | null;
  image: string | null;
}

/** The profile payload returned by every GET/PATCH — user, handle, counts. */
export interface ProfileView {
  nickname: string;
  user: ProfileUser;
  counts: ProfileCounts;
  createdAt: Date;
  updatedAt: Date;
}
