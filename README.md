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
| `/api/auth/forget-password` | POST | Sends reset mail (Phase 3 activates its UI path). |
| `/api/auth/reset-password` | POST | Consumes reset token. |
| `/api/auth/sign-out` | POST | Revokes the session identified by the request cookie (other sessions stay). |
| `/api/auth/error` | GET | Error redirect target. |

CSRF: mutating endpoints require a same-origin request or an `Origin` listed in
`CORS_ORIGIN_URLS` (see `.env.example`).

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
