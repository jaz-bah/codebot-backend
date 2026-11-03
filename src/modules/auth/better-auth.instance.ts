import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import { kyselyAdapter } from '@better-auth/kysely-adapter';
import { AppConfig } from '../../config/configuration';
import { createKyselyPool } from '../../database/kysely/pool';
import { getAuthKysely } from '../../database/kysely/auth-db';
import { ensureUniqueUsername } from './username-generator';
import { MailService } from '../mail/mail.service';
import { buildSocialProviders } from './social-providers';
import { promoteAdminUsers, shouldPromote } from '../admin/admin-promote';

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
      // FR: password reset invalidates every live session of the account
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async () => {
        // hook marker: reset completed successfully (audit arrives Phase 3/final)
      },
      sendResetPassword: async ({ user, url }) => {
        // FR-4 — forget-password flow, tested in Phase 3 e2e
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

    plugins: [
      // Unique per-user handle for the chat people-search (username column on
      // the user table; normalized to lowercase; defaults: 3–30 chars,
      // [a-zA-Z0-9_.]). OPTIONAL at signup — omitting it does not break the
      // email/password flow. `displayUsername` disabled keeps the schema a
      // single additive column (user.username) — pass the same flag to
      // usernameClient() on the client side.
      username({ displayUsername: false }),
    ],

    socialProviders: buildSocialProviders(config.oauth),

    // Rate limiting (network layer, IP-ranked) — built-in special rules in
    // better-auth 1.7 enforce 3 req/10 s on sign-in|sign-up|change-* and
    // 3 req/60 s on forget-password|resend paths. Always on (dev included).
    rateLimit: {
      enabled: true,
      window: 10,
      max: 100,
    },

    // US-6: promote ADMIN_EMAIL users to role=admin on login (server-side,
    // never settable via signup/payload). Fails safe — never blocks sign-in.
    // FR-auto-username: every account also gets a unique handle at creation —
    // unless the client supplied a username (the plugin validates that path),
    // one is derived from email/name and made unique against the user table.
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            try {
              const candidate = user as {
                email?: string | null;
                name?: string | null;
                username?: string | null;
              };
              if (candidate.username && candidate.username.trim()) return;
              const username = await ensureUniqueUsername(getAuthKysely(config.databaseUrl), {
                email: candidate.email ?? null,
                name: candidate.name ?? null,
              });
              return { data: { ...user, username } };
            } catch (e) {
              // Fail-safe: signup proceeds without a handle (the profile
              // module backfills one lazily on GET /profile).
              ctx?.context?.logger?.error?.(
                `username generator failed: ${e instanceof Error ? e.message : String(e)}`,
              );
              return undefined;
            }
          },
        },
      },
      session: {
        create: {
          after: async (session: { userId: string }, ctx) => {
            try {
              if (!session?.userId || !config.adminEmails.length) return;
              const db = getAuthKysely(config.databaseUrl);
              const user = await db
                .selectFrom('user')
                .select(['id', 'email', 'emailVerified', 'role'])
                .where('id', '=', session.userId)
                .executeTakeFirst();
              if (!user) return;
              const candidate = {
                email: String(user.email),
                emailVerified: Boolean(user.emailVerified),
                role: user.role == null ? null : String(user.role),
              };
              if (!shouldPromote(candidate, config.adminEmails)) return;
              const promoted = await promoteAdminUsers(db, config.adminEmails);
              ctx?.context?.logger?.info?.(
                `admin bootstrap: promoted ${promoted.join(', ') || '(none)'}`,
              );
            } catch (e) {
              ctx?.context?.logger?.error?.(
                `admin bootstrap (session hook) failed: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          },
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
