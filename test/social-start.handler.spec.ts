import { createSocialOAuthStartHandler, trustedCallback } from '../src/modules/auth/social-start.handler';
import { AppConfig } from '../src/config/configuration';
import type { Request, Response } from 'express';

/**
 * Unit tests for the GET-only OAuth start bridge (social-start.handler.ts).
 * The bridge exists because Render's Cloudflare edge HTTP-challenges the XHR
 * POST start (Cf-Mitigated: challenge → 429) which an XHR can never solve —
 * see the module docblock.
 */

let lastRedirect: { status: number; url: string } | null = null;
let appendedCookies: string[] = [];

function fakeRes(): Response {
  return {
    setHeader: jest.fn(),
    append: (_name: string, value: string) => {
      appendedCookies.push(value);
    },
    redirect: (status: number, url: string) => {
      lastRedirect = { status, url };
    },
  } as unknown as Response;
}

function fakeReq(query: Record<string, string>): Request {
  return { query, ip: '203.0.113.7' } as unknown as Request;
}

function fakeAuth({
  providerIds = ['google', 'github'],
  authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth?state=abc',
  fail = false,
} = {}) {
  return {
    options: { socialProviders: Object.fromEntries(providerIds.map((id) => [id, {}])) },
    api: {
      signInSocial: jest.fn(async () => {
        if (fail) throw new Error('PROVIDER_NOT_FOUND');
        return {
          response: { redirect: true, url: authorizeUrl },
          headers: {
            get: () => 'better-auth.state=abc; Path=/; HttpOnly',
            getSetCookie: () => ['better-auth.state=abc; Path=/; HttpOnly'],
          },
        };
      }),
    },
  } as never; // cast: full AuthInstance is far bigger than the used surface
}

function appConfig(): AppConfig {
  return {
    frontendUrl: 'https://codebotapp.onrender.com',
    corsOriginUrls: ['https://codebotapp.onrender.com', 'http://localhost:3001'],
  } as unknown as AppConfig;
}

const handler = createSocialOAuthStartHandler({
  auth: fakeAuth() as never,
  config: appConfig(),
});

beforeEach(() => {
  lastRedirect = null;
  appendedCookies = [];
});

describe('createSocialOAuthStartHandler', () => {
  it('302s to the provider authorize URL and forwards the state cookie', async () => {
    await handler(
      fakeReq({
        provider: 'google',
        callbackURL: 'https://codebotapp.onrender.com/dashboard',
        newUserCallbackURL: 'https://codebotapp.onrender.com/auth/sign-up',
        errorCallbackURL: 'https://codebotapp.onrender.com/auth/sign-in',
      }),
      fakeRes(),
    );
    expect(lastRedirect).toEqual({
      status: 302,
      url: 'https://accounts.google.com/o/oauth2/v2/auth?state=abc',
    });
    expect(appendedCookies.join('|')).toContain('better-auth.state=abc');
  });

  it('rejects unconfigured/unknown providers with a safe error redirect', async () => {
    await handler(fakeReq({ provider: 'notarealprovider' }), fakeRes());
    expect(lastRedirect?.url).toBe(
      'https://codebotapp.onrender.com/auth/sign-in?error=provider_unavailable',
    );
  });

  it('falls back to same-origin defaults for cross-origin callback URLs', async () => {
    const auth = fakeAuth() as never;
    const instance = createSocialOAuthStartHandler({ auth, config: appConfig() });
    await instance(
      fakeReq({
        provider: 'github',
        callbackURL: 'https://evil.example.com/phish',
        newUserCallbackURL: '//evil.example.com',
        errorCallbackURL: 'not a url',
      }),
      fakeRes(),
    );
    expect(lastRedirect?.status).toBe(302);
    const deps = (auth as unknown as {
      api: { signInSocial: jest.Mock };
    }).api.signInSocial.mock.calls[0][0].body;
    expect(deps.callbackURL).toBe('https://codebotapp.onrender.com/dashboard');
    expect(deps.newUserCallbackURL).toBe('https://codebotapp.onrender.com/auth/sign-up');
    expect(deps.errorCallbackURL).toBe('https://codebotapp.onrender.com/auth/sign-in');
  });

  it('redirects to the error page with oauth_start_failed when BetterAuth errors', async () => {
    const instance = createSocialOAuthStartHandler({
      auth: fakeAuth({ providerIds: ['google'], fail: true }) as never,
      config: appConfig(),
    });
    await instance(fakeReq({ provider: 'google' }), fakeRes());
    expect(lastRedirect?.url).toBe(
      'https://codebotapp.onrender.com/auth/sign-in?error=oauth_start_failed',
    );
  });

  it('rate limits repeated starts per IP (safety net: direct auth.api calls skip BetterAuth limiter)', async () => {
    const instance = createSocialOAuthStartHandler({
      auth: fakeAuth() as never,
      config: appConfig(),
    });
    const res = fakeRes();
    for (let i = 0; i < 10; i += 1) {
      await instance(fakeReq({ provider: 'google' }), res);
    }
    await instance(fakeReq({ provider: 'google' }), res);
    expect(lastRedirect?.url).toBe(
      'https://codebotapp.onrender.com/auth/sign-in?error=too_many_requests',
    );
  });
});

describe('trustedCallback', () => {
  const origins = new Set(['https://app.test']);
  it('accepts trusted absolute URLs and rooted paths, rejects the rest', () => {
    expect(trustedCallback('https://app.test/x', origins, 'fb')).toBe('https://app.test/x');
    expect(trustedCallback('/dashboard', origins, 'fb')).toBe('/dashboard');
    expect(trustedCallback('//evil.test', origins, 'fb')).toBe('fb');
    expect(trustedCallback('https://evil.test', origins, 'fb')).toBe('fb');
    expect(trustedCallback('garbage', origins, 'fb')).toBe('fb');
    expect(trustedCallback('', origins, 'fb')).toBe('fb');
    expect(trustedCallback(undefined, origins, 'fb')).toBe('fb');
  });
});
