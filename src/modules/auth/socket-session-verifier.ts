import { getAuthKysely } from '../../database/kysely/auth-db';
import { extractSessionCookie, verifySessionCookieSignature, SocketSession } from './socket-session';

/**
 * DB-backed half of the WS session verification (never imported by the jest
 * suite — kysely is ESM-only).
 *
 * Credential-free verifier factory used by the Socket.IO gateway. Takes the
 * app config once (DB URL + BetterAuth secret) and returns a per-handshake
 * function over the raw cookie header. Looks the token up in the
 * BetterAuth-owned `session` table (unexpired) via the SAME read-only Kysely
 * pool helper the auth hooks use — never written from here. Never throws —
 * resolves to null on any failure.
 */
export function createSocketSessionVerifier({ databaseUrl, secret }: {
  databaseUrl: string;
  secret: string;
}): (rawCookieHeader: string | undefined | null) => Promise<SocketSession | null> {
  const db = getAuthKysely(databaseUrl);
  return async (rawCookieHeader) => {
    try {
      const token = verifySessionCookieSignature(extractSessionCookie(rawCookieHeader), secret);
      if (!token) return null;
      const now = Date.now();
      const row = await db
        .selectFrom('session')
        .select(['id as sessionId', 'token', 'userId', 'expiresAt'])
        .where('token', '=', token)
        .executeTakeFirst();
      if (!row) return null;
      if (new Date(row.expiresAt).getTime() <= now) return null;
      return { userId: row.userId, sessionId: row.sessionId, token: row.token };
    } catch {
      return null;
    }
  };
}
