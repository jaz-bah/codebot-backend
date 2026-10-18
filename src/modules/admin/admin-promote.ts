import { Kysely } from 'kysely';
import { AuthBaseDB } from '../../database/kysely/auth-db';

export interface PromoteCandidateLike {
  email: string;
  emailVerified: boolean;
  role: string | null;
}

/**
 * FR-5/US-6 decision logic — pure, unit tested:
 * a user is promoted iff the email is in `ADMIN_EMAILS`, the address is
 * VERIFIED, and the user is not an admin already.
 */
export function shouldPromote(
  u: { email: string; emailVerified: boolean; role: string | null },
  adminEmails: readonly string[],
): boolean {
  const list = adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  if (!u.emailVerified) return false;
  if (u.role === 'admin') return false;
  return list.includes(u.email.trim().toLowerCase());
}

/**
 * Idempotent boot/login promotion. Returns the list of emails promoted this
 * call. Failures are thrown to the caller — callers must catch (e.g. boot
 * promotion logs and continues, session-hook promotion never blocks login).
 */
export async function promoteAdminUsers(
  db: Kysely<AuthBaseDB>,
  adminEmails: readonly string[],
): Promise<string[]> {
  const targets = adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!targets.length) return [];
  const rows = await db
    .updateTable('user')
    .set({ role: 'admin' })
    .where('emailVerified', '=', true)
    .where('role', 'is not', 'admin')
    .where('email', 'in', targets as string[])
    .returning(['email'])
    .execute();
  return rows.map((r) => r.email);
}
