import type { Request, Response } from 'express';
import { AuthInstance } from './better-auth.instance';
import { AppConfig } from '../../config/configuration';

/**
 * GET-only OAuth start bridge: `/api/auth/sign-in/social/start`.
 *
 * WHY (Render's Cloudflare edge kills the XHR start): on *.onrender.com the
 * platform's Cloudflare layer can gate suspicious-looking POSTs with a managed
 * challenge (`Cf-Mitigated: challenge` → HTTP 429/403 interstitial). A better
 * auth client start is a fetch() POST — the browser cannot render or solve a
 * challenge inside an XHR, so users just saw "Something went wrong (429)" on
 * the Google/GitHub buttons. A TOP-LEVEL document navigation to this endpoint
 * survives the same edge: if challenged, the browser renders the interstitial,
 * the user solves it, and the flow continues (GET → 302 provider).
 *
 * Flow: browser navigates here (full page, NOT an XHR) → we call BetterAuth's
 * `signInSocial` internally (creates the state row + `better-auth.state`
 * cookie) → forward the state cookie same-origin (first-party via server.mjs
 * proxy) → 302 to the provider's authorize URL. The OAuth callback path
 * (`/callback/<provider>`) is untouched.
 *
 * Security notes:
 * - Provider/credentials/state never touch the browser in plaintext.
 * - Supplied callback URLs are validated against CORS_ORIGIN_URLS / relative
 *   paths only — no open redirect, no attacker-controlled post-OAuth landing.
 * - A tiny per-IP window limiter keeps the "auth endpoints are rate limited"
 *   invariant: BetterAuth's own limiter (router onRequest) does NOT run for
 *   direct `auth.api.*` calls, and Nest's Throttler doesn't cover this
 *   express-level route.
 */

/** Simple sliding-window bucket: 10 OAuth starts per 60s per client IP. */
const LIMIT_WINDOW_MS = 60_000;
const LIMIT_MAX_STARTS = 10;

export function createSocialOAuthStartHandler({
  auth,
  config,
}: {
  auth: AuthInstance;
  config: AppConfig;
}) {
  const frontendOrigin = config.frontendUrl.replace(/\/+$/, '');
  // Only exact-origin matches from CORS_ORIGIN_URLS / FRONTEND_URL are trusted
  // for absolute callbacks (mirrors BetterAuth's own trustedOrigins rule).
  const trustedOrigins = new Set(
    [...config.corsOriginUrls, config.frontendUrl].map((origin) =>
      normalizeOrigin(origin),
    ),
  );
  const defaultCallbackURL = `${frontendOrigin}/dashboard`;
  const defaultErrorPage = `${frontendOrigin}/auth/sign-in`;

  const startedAtByIp = new Map<string, number[]>();

  return async function socialOAuthStart(
    req: Request,
    res: Response,
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');

    const clientIp = req.ip ?? 'unknown';
    if (!allowStart(startedAtByIp, clientIp)) {
      redirectToError(res, defaultErrorPage, 'too_many_requests');
      return;
    }

    const provider =
      typeof req.query.provider === 'string' ? req.query.provider.trim() : '';
    const configuredProviderIds = Object.keys(auth.options.socialProviders ?? {});
    if (!provider || !configuredProviderIds.includes(provider)) {
      redirectToError(res, defaultErrorPage, 'provider_unavailable');
      return;
    }

    const body = {
      provider,
      callbackURL: trustedCallback(
        req.query.callbackURL,
        trustedOrigins,
        defaultCallbackURL,
      ),
      newUserCallbackURL: trustedCallback(
        req.query.newUserCallbackURL,
        trustedOrigins,
        `${frontendOrigin}/auth/sign-up`,
      ),
      errorCallbackURL: trustedCallback(
        req.query.errorCallbackURL,
        trustedOrigins,
        defaultErrorPage,
      ),
    };

    try {
      // Forward the incoming headers so BetterAuth still sees cookie/proto
      // context (e.g. x-forwarded-* → client IP), even though the internal
      // call skips the HTTP router middlewares.
      const { response, headers } = await auth.api.signInSocial({
        body,
        headers: req.headers as unknown as Record<string, string>,
        returnHeaders: true,
      });
      const authorizeUrl =
        response && 'url' in response ? (response.url as string) : undefined;
      if (!authorizeUrl) {
        throw new Error('signInSocial returned no authorize URL');
      }

      // Relay the state (+ nonce, PKCE, etc.) cookies set by BetterAuth so the
      // callback step can validate them — same as the XHR flow did on success.
      for (const cookie of collectSetCookie(headers)) {
        res.append('Set-Cookie', cookie);
      }
      res.redirect(302, authorizeUrl);
    } catch (error) {
      console.warn(
        `[social-start] provider=${provider} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      redirectToError(res, defaultErrorPage, 'oauth_start_failed');
    }
  };
}

/** Keeps only same-origin (trusted) or same-app relative callbacks. */
export function trustedCallback(
  value: unknown,
  trustedOrigins: Set<string>,
  fallback: string,
): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const trimmed = value.trim();
  if (trimmed.startsWith('/')) {
    // Protocol-relative "//host" is a cross-origin trick — reject it.
    return trimmed.startsWith('//') ? fallback : trimmed;
  }
  try {
    return trustedOrigins.has(normalizeOrigin(new URL(trimmed).origin))
      ? trimmed
      : fallback;
  } catch {
    return fallback;
  }
}

function collectSetCookie(headers: unknown): string[] {
  const withGetSetCookie = headers as { getSetCookie?: () => string[] } | null;
  if (withGetSetCookie && typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie();
  }
  const value = (headers as { get?: (name: string) => string | null })?.get?.(
    'set-cookie',
  );
  return value ? [value] : [];
}

function redirectToError(
  res: Response,
  errorPage: string,
  errorCode: string,
): void {
  const url = new URL(errorPage);
  url.searchParams.set('error', errorCode);
  res.redirect(302, url.toString());
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

/** Prunes-and-records a start; returns false when the IP hit the window cap. */
function allowStart(
  startedAtByIp: Map<string, number[]>,
  ip: string,
): boolean {
  const now = Date.now();
  // Opportunistic cleanup keeps the map bounded without a background timer.
  if (startedAtByIp.size > 50_000) {
    startedAtByIp.clear();
  }
  const starts = (startedAtByIp.get(ip) ?? []).filter(
    (ts) => now - ts < LIMIT_WINDOW_MS,
  );
  if (starts.length >= LIMIT_MAX_STARTS) {
    startedAtByIp.set(ip, starts);
    return false;
  }
  starts.push(now);
  startedAtByIp.set(ip, starts);
  return true;
}
