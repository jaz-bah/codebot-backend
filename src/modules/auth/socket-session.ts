import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Session-cookie verification for the Socket.IO gateway (PURE logic — no DB,
 * no better-auth runtime imports so jest loads it in the CommonJS suite).
 *
 * WHY NOT auth.api.getSession:
 * the HTTP-shim route intermittently returned an empty session for a provably
 * valid cookie when called from the WS handshake path (async-context /
 * request-parsing quirks of the better-call shim). The gateway verifies the
 * EXACT same artifact deterministically instead of re-invoking the shim:
 *
 * 1. parse the raw `cookie` header for `better-auth.session_token`
 *    (`__Host-`/`__Secure-` prefixed variants too);
 * 2. value is `<token>.<HMAC-SHA256(secret, token), base64>` — signed exactly
 *    like better-auth's `setSignedCookie` (better-call/src/crypto.ts:
 *    standard base64 of a 32-byte digest, cookie value URL-encoded). The
 *    signature is verified with a constant-time comparison;
 * 3. the DB check lives in socket-session-verifier.ts (kysely), wired via the
 *    WS_SESSION_VERIFIER provider in AuthModule.
 */

/** Same cookie names better-auth issues (default + secure/host prefix). */
const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
  '__Host-better-auth.session_token',
];

/** Resolved WS-session identity a gateway stores per socket. */
export interface SocketSession {
  userId: string;
  sessionId: string;
  token: string;
}

/**
 * Find the signed session-token morsel in a raw Cookie header.
 * (Handshake headers keep cookies as `name=value; name2=value2`.)
 */
export function extractSessionCookie(rawCookieHeader: string | undefined | null): string | null {
  if (!rawCookieHeader) return null;
  for (const part of rawCookieHeader.split(';')) {
    const sep = part.indexOf('=');
    if (sep < 0) continue;
    const name = part.slice(0, sep).trim();
    if (!SESSION_COOKIE_NAMES.includes(name)) continue;
    // Values are URL-encoded by better-auth when set (may contain %2B/%3D).
    return decodeURIComponent(part.slice(sep + 1).trim()) || null;
  }
  return null;
}

/**
 * Verify the `<token>.<signature>` morsel's HMAC. Returns the raw session
 * token when the signature checks out, else null (never throws).
 *
 * Format reproduced from better-call (better-auth basis): standard base64 of a
 * 32-byte HMAC-SHA256 over the token, separated by a single '.', compared
 * constant-time.
 */
export function verifySessionCookieSignature(morsel: string | null, secret: string): string | null {
  if (!morsel || !secret) return null;
  const sigStart = morsel.lastIndexOf('.');
  if (sigStart < 1) return null;
  const token = morsel.slice(0, sigStart);
  const signature = morsel.slice(sigStart + 1);
  // 32-byte digest → exactly 44 base64 chars ending in '='.
  if (token.length === 0 || signature.length !== 44 || !signature.endsWith('=')) return null;
  const expected = createHmac('sha256', secret).update(token).digest('base64');
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return token;
}
