import { betterAuth } from 'better-auth';
import { kyselyAdapter } from '@better-auth/kysely-adapter';
import { AppConfig } from '../../config/configuration';
import { createKyselyPool } from '../../database/kysely/pool';

export interface BetterAuthDeps {
  config: AppConfig;
}

/**
 * The single BetterAuth instance for the app.
 *
 * - Auth tables are owned by BetterAuth via its OFFICIAL Kysely Postgres adapter
 *   (PRD decision D1). The community TypeORM adapter is deliberately not used.
 * - `role` is a server-only additional field (input: false — PRD FR-5).
 * - Social providers and mail callbacks are switched on in Phase 1 / Phase 2.
 */
export function buildAuth({ config }: BetterAuthDeps) {
  const db = createKyselyPool(config.databaseUrl);

  return betterAuth({
    database: kyselyAdapter(db, {
      type: 'postgres',
    }),
    // baseURL must include the mount path — the handler is served at /api/auth/**
    baseURL: `${config.appUrl.replace(/\/+$/, '')}/api/auth`,
    secret: config.betterAuthSecret,
    trustedOrigins: config.corsOriginUrls,

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: true, // FR-1: verified email before usable session
    },

    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'user',
          input: false, // never settable by client payloads (FR-5)
        },
      },
    },

    account: {
      accountLinking: {
        enabled: true,
        allowDifferentEmails: false, // FR-3: no linking against unverified emails
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days, sliding refresh (FR-6)
      cookieCache: { enabled: false },
    },

    advanced: {
      useSecureCookies: config.nodeEnv === 'production',
      defaultCookieAttributes: {
        sameSite: 'lax',
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        path: '/',
      },
    },

    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'debug',
    },
  });
}

export type AuthInstance = ReturnType<typeof buildAuth>;
