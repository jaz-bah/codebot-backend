# backend-app — Codebot SaaS Backend

NestJS backend for the Codebot SaaS. Authentication is built on
[BetterAuth](https://www.better-auth.com/) (official Kysely Postgres adapter)
running on Neon Postgres; domain data uses TypeORM (separate tables — PRD D1).

## Quick start

```bash
npm install            # install deps
cp .env.example .env   # then fill in real values
npm run init:db        # create/patch the 4 BetterAuth tables (idempotent)
npm run build          # tsc + copy mail templates into dist/
npm start              # serve on $PORT (default 3000)
npm run start:dev      # ts-node-dev hot reload
npm test               # unit tests (jest + ts-jest)
node scripts/e2e-phase1.mjs   # full auth-flow E2E (server must be running)
```

## Auth endpoints (`/api/auth/**`)

| Endpoint | Method | Notes |
|---|---|---|
| `/api/auth/sign-up/email` | POST | Creates user (`emailVerified=false`), sends verification mail (FR-2). No session issued. |
| `/api/auth/sign-in/email` | POST | Blocked with `403 EMAIL_NOT_VERIFIED` until verified. Sets httpOnly `better-auth.session_token` cookie. |
| `/api/auth/get-session` | GET | Returns `{user, session}` or `null`. `role` is server-managed (`user` default, FR-5). |
| `/api/auth/verify-email` | GET | `?token=<JWT>&callbackURL=…` — single-use, 1 h expiry. Auto signs the user in on success (US-1). |
| `/api/auth/request-password-reset` | POST | Sends reset mail (FR-4). Token is stateless in the URL path. |
| `/api/auth/reset-password` | POST | `{newPassword, token}` — single-use; revokes ALL sessions of the account. |
| `/api/auth/sign-out` | POST | Revokes the session identified by the request cookie (other sessions stay). |
| `/api/auth/sign-in/social` | POST | `{provider:'google'|'github'}` → authorizes at the real provider (302 + `{url,redirect:true}`). State cookie set automatically. |
| `/api/auth/callback/google` · `/api/auth/callback/github` | GET | Provider redirects back here with `?code` — handled internally by BetterAuth. |
| `/api/auth/error` | GET | Error redirect target. |

CSRF: mutating endpoints require a same-origin request or an `Origin` listed in
`CORS_ORIGIN_URLS` (see `.env.example`).

### Rate limiting

- **Auth endpoints** (BetterAuth-owned): built-in limiter — 3 req/10 s on
  `sign-in` / `sign-up` / `change-*`, 3 req/60 s on `request-password-reset`;
  generic 100 req/10 s elsewhere. In-memory per process (single-node SaaS).
- **Nest routes**: global `ThrottlerGuard` (`THROTTLE_TTL_MS/LIMIT`, default
  60 s/100 req). Over-limit → `429` (`X-Retry-After` for auth routes).

### Nest routes & guards (Phase 3)

| Route | Auth | Notes |
|---|---|---|
| `GET /health` | public | db ping |
| `GET /admin/me` | admin | smoke endpoint: returns the resolved session user |
| `GET /admin/stats` | admin | users, verifiedUsers, activeSessions, signups30d |
| `GET /admin/users?page&limit` | admin | paginated user list (+session counts) |

Guard chain: `ThrottlerGuard` → `BetterAuthSessionGuard` (global; resolves the
BetterAuth session once and attaches `authUser`/`authSession`; `/api/auth/**`
pass-through) → `AdminGuard` at controller level reading `@Roles('admin')`.
Every 401/403 denial writes an `audit_log` row (`ACCESS_DENIED`, sanitized
context — no tokens/passwords — see `AuditService.sanitizeDetail`).

Admin lifecycle (FR-5/US-6): emails listed in `ADMIN_EMAIL` env are promoted to
`role='admin'` **at boot** (`AdminBootstrapService`) and **on login**
(BetterAuth `databaseHooks.session.create.after`), verified users only,
idempotent, never settable via signup payloads.

Uniform Nest error envelope: `{statusCode, message, error, timestamp, path}`
(`HttpExceptionFilter`). Error envelopes never leak stack traces/DTO internals.

### OAuth setup (Phase 2)

Registered in `Google Cloud Console`/`GitHub Developer settings` as follows:

| Provider | Authorized redirect URI | Credentials env |
|---|---|---|
| Google | `${APP_URL}/api/auth/callback/google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub | `${APP_URL}/api/auth/callback/github` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |

Providers activate **pairwise conditionally** in `buildSocialProviders` —
absent creds = email-only instance (dev-safe). Linking: enabled, but only for
verified emails (`account.accountLinking.allowDifferentEmails = false`, FR-3).
First-time social signups create verified users (provider asserts email
ownership via `email_verified`).

## Dev helpers

- **`.mail-capture.jsonl`** — in `NODE_ENV != production` every mail send is
  appended here (to/subject/url). Lets scripted E2E pick up verification links
  without an inbox. Never written in production; gitignored.
- **`scripts/e2e-phase1.mjs`** — end-to-end auth flow: signup → verify
  (auto-sign-in) → sign-out → sign-in → get-session → sign-out (9 steps).
- **`npm run auth:schema`** — regenerates + applies BetterAuth DDL from
  `auth.options`; SQL reference in `docs/schema/better-auth-schema.sql`.

## Module map

- `src/config/` — Joi-validated env → typed `AppConfig` (`APP_CONFIG` token)
- `src/database/kysely/` — pg Pool for BetterAuth · `src/database/typeorm/` — domain DataSource
- `src/modules/auth/` — BetterAuth instance + DI module (mounted at `/api/auth/**` in `main.ts`)
- `src/modules/mail/` — Nodemailer + templates (verify-email, reset-password)
- `src/modules/health/` — `GET /health`

Governance docs (PRD, ARCHITECTURE, ROADMAP, TASKS, LOG, MEMORY) live in `../Brain/`.
