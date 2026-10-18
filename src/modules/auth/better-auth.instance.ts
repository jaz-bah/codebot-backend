import { betterAuth } from 'better-auth';
import { kyselyAdapter } from '@better-auth/kysely-adapter';
import { AppConfig } from '../../config/configuration';
import { createKyselyPool } from '../../database/kysely/pool';
import { MailService } from '../mail/mail.service';
import { buildSocialProviders } from './social-providers';

export interface BetterAuthDeps {
  config: AppConfig;
  mail: MailService;
}

/**
 * The single BetterAuth instance for the app.
 *
 * - Auth tables are owned by BetterAuth via its OFFICIAL Kysely Postgres adapter
 *   (PRD decision D1). The community TypeORM adapter is deliberately not used.
 * - `role` is a server-only additional field (input: false — PRD FR-5).
 * - Mail callbacks live in MailService (FR-9: failures never break auth).
 * - Social providers (FR-3): registered conditionally from env creds.
 */
export function buildAuth({ config, mail }: BetterAuthDeps) {
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
      sendResetPassword: async ({ user, url }) => {
        // FR-4 — path wired here, activated & tested in Phase 3
        await mail.sendResetPassword({ email: user.email, name: user.name }, url);
      },
    },

    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        // FR-2: Nodemailer verification mail (MailModule), fail-safe (FR-9)
        await mail.sendVerificationEmail({ email: user.email, name: user.name }, url);
      },
      sendOnSignUp: true, // FR-2: verification email on signup
      autoSignInAfterVerification: true, // US-1: click → verified → signed in
      expiresIn: 60 * 60, // 1 hour, single-use via `verification` table
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

    socialProviders: buildSocialProviders(config.oauth),

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
