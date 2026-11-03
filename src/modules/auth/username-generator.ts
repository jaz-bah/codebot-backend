import { randomBytes } from 'crypto';
import type { Kysely } from 'kysely';
import { AuthBaseDB } from '../../database/kysely/auth-db';

/**
 * Unique-username generation for account creation (FR: every account gets a
 * handle automatically). Shaped EXACTLY like the BetterAuth username plugin's
 * defaults — lowercase [a-z0-9_.], 3–30 chars — so every generated value is
 * one the plugin itself would accept, and chat people-search
 * (`user.username IS NOT NULL`) finds every user.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

/** Pattern-mirroring regex (lowercased form of the plugin's [a-zA-Z0-9_.] rule). */
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;

/** Suffix recipe: 3 chars from an unambiguous alphabet (no i/l/o/0/1). */
const SUFFIX_LENGTH = 3;
const SUFFIX_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const SUFFIX_ATTEMPTS = 10;

export interface UsernameSource {
  email?: string | null;
  name?: string | null;
}

/**
 * Deterministic base handle: the email local-part (falls back to display
 * name, then `'user'`). Runs of disallowed characters collapse to `_`,
 * edges are trimmed, too-short results are padded, and the result is
 * always 3–30 chars of the plugin pattern.
 */
export const buildUsernameBase = (source: UsernameSource): string => {
  const raw = source.email?.includes('@') ? source.email.split('@')[0] : source.name;
  const cleaned = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '_') // runs of anything else → single underscore
    .replace(/_{2,}/g, '_')
    .replace(/^[_]+|_+$/g, '');
  if (!cleaned) return 'user';
  if (cleaned.length < USERNAME_MIN_LENGTH) return `user_${cleaned}`;
  return cleaned.slice(0, USERNAME_MAX_LENGTH);
};

const randomSuffix = (length: number): string => {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length];
  return out;
};

/**
 * First FREE candidate wins: the clean base, then `base_x2j`-style suffixed
 * draws (uniqueness checked against the user table, DB unique index
 * `uq_user_username` backstops any residual race). Throws when a free handle
 * cannot be found — callers decide fail-safe behavior (the signup hook logs
 * and proceeds without a username; profile backfill returns null).
 */
export async function ensureUniqueUsername(
  db: Kysely<AuthBaseDB>,
  source: UsernameSource,
): Promise<string> {
  const base = buildUsernameBase(source);
  const candidates = [base];
  for (let i = 1; i < SUFFIX_ATTEMPTS; i++) {
    const stem = base.slice(0, USERNAME_MAX_LENGTH - 1 - SUFFIX_LENGTH);
    candidates.push(`${stem}_${randomSuffix(SUFFIX_LENGTH)}`);
  }
  const rows = await db
    .selectFrom('user')
    .select('username')
    .where('username', 'in', candidates as string[])
    .execute();
  const taken = new Set(rows.map((r) => (r.username == null ? '' : String(r.username))));
  const free = candidates.find((c) => !taken.has(c));
  if (free) return free;
  throw new Error(`could not allocate a unique username for base "${base}"`);
}
