import { createHmac } from 'node:crypto';
import { extractSessionCookie, verifySessionCookieSignature } from '../src/modules/auth/socket-session';

/**
 * Signed session-cookie contract for the WS gateway — reproduces better-auth's
 * cookie format (better-call signing: `<token>.<base64 HMAC-SHA256>`, 44-char
 * signature, URL-encoded cookie value).
 */

const SECRET = 'unit-test-secret';

/** Sign exactly like better-call's signCookieValue. */
const signed = (token: string): string =>
  `${token}.${createHmac('sha256', SECRET).update(token).digest('base64')}`;

const cookieHeader = (value: string): string =>
  // better-auth sets the URL-encoded morsel on the session_token cookie
  `better-auth.session_token=${encodeURIComponent(value)}`;

describe('socket session cookie extraction', () => {
  it('reads the signed morsel back (URL-encoded values OK)', () => {
    const morsel = signed('some+token/==');
    expect(extractSessionCookie(cookieHeader(morsel))).toBe(morsel);
  });

  it('handles secure-prefixed cookies and extra cookies', () => {
    const morsel = signed('abc');
    expect(
      extractSessionCookie(`a=1; __Secure-better-auth.session_token=${encodeURIComponent(morsel)}; b=2`),
    ).toBe(morsel);
  });

  it('returns null for missing/invalid headers', () => {
    expect(extractSessionCookie(undefined)).toBeNull();
    expect(extractSessionCookie('')).toBeNull();
    expect(extractSessionCookie('better-auth.badcookie=1')).toBeNull();
  });
});

describe('socket session cookie signature verification', () => {
  it('accepts a genuinely signed morsel and returns the bare token', () => {
    expect(verifySessionCookieSignature(signed('good-token'), SECRET)).toBe('good-token');
  });

  it('rejects a bad or missing signature', () => {
    expect(verifySessionCookieSignature('no-signature', SECRET)).toBeNull();
    expect(verifySessionCookieSignature('good-token.not-a-hmac', SECRET)).toBeNull();
    expect(
      createHmac('sha256', `${SECRET}x`).update('good-token').digest('base64').length,
    ).toBe(44); // same format, wrong secret → 44 chars but wrong bytes
    expect(
      verifySessionCookieSignature(
        `good-token.${createHmac('sha256', `${SECRET}x`).update('good-token').digest('base64')}`,
        SECRET,
      ),
    ).toBeNull();
  });

  it('rejects tampered tokens', () => {
    expect(verifySessionCookieSignature(`${signed('good-token')}x`, SECRET)).toBeNull();
  });

  it('rejects empty inputs', () => {
    expect(verifySessionCookieSignature(null, SECRET)).toBeNull();
    expect(verifySessionCookieSignature(signed('t'), '')).toBeNull();
  });
});
