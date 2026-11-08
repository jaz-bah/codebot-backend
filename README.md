# backend-app — Codebot SaaS Backend

NestJS backend for the Codebot SaaS. Authentication is built on
[BetterAuth](https://www.better-auth.com/) (official Kysely Postgres adapter)
running on Neon Postgres; domain data uses TypeORM (separate tables — PRD D1).

## Quick start

```bash
npm install            # install deps
cp .env.example .env   # then fill in real values
npm run init:db        # create/patch the BetterAuth tables (idempotent)
npm run migration:run  # apply TypeORM domain migrations (audit_log, …)
npm run build          # tsc + copy mail templates into dist/
npm start              # serve on $PORT (default 3000)
npm run start:dev      # ts-node-dev hot reload
npm test               # unit tests (94, jest + ts-jest)
```

## Automated E2E suite

Four scripted HTTP suites prove the whole contract against the real app+DB
(server must be running; dev mail capture provides verification/reset links):

```bash
npm run e2e    # runs e2e-phase1 → phase2 → phase3 → edge → todos → notes (stops on first failure)node scripts/e2e-phase1.mjs   # US-1 flow: signup→verify(auto-signin)→signout→signin→session→signout (9)
node scripts/e2e-phase2.mjs   # OAuth wiring: authorize redirects + state cookie (4)
node scripts/e2e-phase3.mjs   # reset flow + 401/403 guards + audit row + 429 (7)
node scripts/e2e-edge.mjs     # unverified login rejected, resend, idempotent token, garbage token (7)
node scripts/e2e-todos.mjs    # todos CRUD, pagination/search/sort/reorder, user isolation
node scripts/e2e-notes.mjs    # workspace files/tree/note content/move/cascade, user isolation (19)
node scripts/e2e-components.mjs # components CRUD/pagination/search/language-filter/verbatim-code/cascade, user isolation (17)
node scripts/e2e-search.mjs    # unified @scope/global search across todos/presets/components/files/notes
node scripts/e2e-profile.mjs   # profile: auto-nickname/claim/409/rotate + live domain counts
```

`.mail-capture.jsonl` (non-production only) records every mail send
`{at,to,subject,url}` so scripts get verification/reset links without a mailbox.

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

**Post-login redirect (prod gotcha):** after the provider sends the browser
back to `/api/auth/callback/google`, BetterAuth redirects to the
`callbackURL` passed to `signIn.social` — and **defaults to `/` resolved
against the `baseURL` (backend) origin** when no absolute URL is passed.
With the frontend on a different host, a missing/relative `callbackURL`
silently lands users on the backend domain. Always pass an **absolute** URL:

```ts
authClient.signIn.social({
  provider: 'google',
  callbackURL: `${FRONTEND_URL}/dashboard`,
  newUserCallbackURL: `${FRONTEND_URL}/welcome`,
  errorCallbackURL: `${FRONTEND_URL}/error`,
});
```

`APP_URL` (backend) and `FRONTEND_URL` (frontend) are deliberately separate
env vars — `APP_URL` must stay on the backend because Google's `redirect_uri`
is registered against it.

## Dev helpers

- **`scripts/e2e-all.mjs`** (`npm run e2e`) — all four E2E suites sequentially with a rate-limit cooldown; total summary, non-zero exit on failure.
- **`npm run e2e`** requires the dev server running locally (`npm start`) — the suites use real HTTP.
- **`npm run auth:schema`** — regenerates + applies BetterAuth DDL from
  `auth.options`; SQL reference in `docs/schema/better-auth-schema.sql`.
- **`npm run migration:run`** — applies TypeORM domain migrations (first: `audit_log`).

## Cookie contract for client teams

- Session cookie: `better-auth.session_token` — **httpOnly, SameSite=Lax**,
  `Secure` in production, 7-day sliding expiry (FR-6). BetterAuth owns its
  format (`<token>.<hmac>`); treat it as opaque and never persist it.
- Send the cookie verbatim for every authenticated call; the frontend needs
  `credentials: 'include'` with CORS origins listed in `CORS_ORIGIN_URLS`.
- Cross-site POSTs must send a real `Origin` under those allowed origins or
  BetterAuth answers `403 MISSING_OR_NULL_ORIGIN` (CSRF defense).
- `get-session` returns `{user:{id,name,email,emailVerified,role,image}, session}`
  or literal `null` — never error bodies.

## Curl cheat sheet

```bash
BASE=http://localhost:3000
ORIGIN=http://localhost:5173   # must be in CORS_ORIGIN_URLS

curl -s $BASE/health
curl -s -X POST $BASE/api/auth/sign-up/email -H "content-type: application/json" -H "origin: $ORIGIN" \
  -d '{"name":"A","email":"a@example.com","password":"strongpass123"}'
# → verification link lands in your inbox (or .mail-capture.jsonl in dev)

curl -s -X POST $BASE/api/auth/request-password-reset -H "content-type: application/json" -H "origin: $ORIGIN" \
  -d '{"email":"a@example.com"}'

curl -s -X POST $BASE/api/auth/reset-password -H "content-type: application/json" -H "origin: $ORIGIN" \
  -d '{"newPassword":"newstrongpass123","token":"<token-from-mail>"}'

curl -s -c cookies.txt -X POST $BASE/api/auth/sign-in/email -H "content-type: application/json" -H "origin: $ORIGIN" \
  -d '{"email":"a@example.com","password":"strongpass123"}'
curl -s -b cookies.txt $BASE/api/auth/get-session
curl -s -b cookies.txt $BASE/admin/stats
curl -s -b cookies.txt -c cookies.txt -X POST $BASE/api/auth/sign-out -H "origin: $ORIGIN" -d '{}'

curl -s -X POST $BASE/api/auth/sign-in/social -H "content-type: application/json" -H "origin: $ORIGIN" \
  -d '{"provider":"google"}'          # → Location: real provider authorize URL + state cookie
```

## Module map

- `src/config/` — Joi-validated env → typed `AppConfig` (`APP_CONFIG` token)
- `src/database/kysely/` — pg Pool for BetterAuth · `src/database/typeorm/` — domain DataSource
- `src/modules/auth/` — BetterAuth instance + DI module (mounted at `/api/auth/**` in `main.ts`)
- `src/modules/mail/` — Nodemailer + templates (verify-email, reset-password)
- `src/modules/health/` — `GET /health`
- `src/modules/todos/` — user todo CRUD, pagination/search/sort/reorder (Phase 5)
- `src/modules/notes/` — workspace file tree (folders + HTML note files) + rich-HTML note content (see below)
- `src/modules/documents/` — user file library: uploaded Cloudinary bytes + persisted metadata (name/description/url) (`/documents`)
- `src/modules/components/` — user UI-component library: name + preview + verbatim code files (`component`/`component_file`) (`/components`, see `../Brain/api-guide/components-api-guide.md`)
- `src/modules/search/` — unified `@scope` search across todos/notes/files/documents/components/presets/experts/tools/IDE-snippets (see `../Brain/api-guide/search-api-guide.md`)
- `src/modules/profile/` — one row per user: unique auto-generated short nickname + live counts over all domain tables (`/profile`, see `../Brain/api-guide/profile-api-guide.md`)

## Notes & workspace files (`/files`, `/notes`)

A per-user **workspace file tree**: `folder` rows (nested, self-referencing DB
FK with `ON DELETE CASCADE`) and `file` rows (`*.html` note documents). Every
`file` row has a 1:1 `note` row holding the rich HTML content (unique FK,
cascade-deleted with the file). All routes require a session; any other user's
row is indistinguishable from "not found" (404) — ownership is scoped server-side.

| Route | Method | Notes |
|---|---|---|
| `GET /files/tree` | GET | Full nested tree (single query, assembled in memory; children ordered by position). |
| `GET /files?parentId&search&type&sortBy&sortOrder&page&limit` | GET | Folder contents (omit `parentId` → root). Sort: `position`/`name`/`createdAt`/`updatedAt`. |
| `POST /files` | POST | Create folder or file. `{name, type, parentId?, content?}`. Files must end in `.html`; sibling names are case-insensitively unique (409). Creating a file seeds its note row in the same transaction. |
| `PATCH /files/:id` | PATCH | Rename and/or move (`{name?, parentId?}`). Rejects moves into self/descendants (400 cycles), recomputes positions, compacts the source folder. |
| `DELETE /files/:id` | DELETE | Deletes the row; FK cascade removes nested folders/files and their notes; sibling positions compacted. |
| `GET /notes?page&limit&search&folderId&sortBy&sortOrder` | GET | All the user's note (file) metadata + tag-stripped `preview` (≤200 chars) — never the raw content. Search matches content AND file name (ILIKE, wildcards escaped). |
| `GET /notes/:fileId` | GET | Full note with rich-HTML `content` for file `:fileId` (400 for folder ids). |
| `PATCH /notes/:fileId` | PATCH | `{content}` — replaces the rich HTML body (≤500 KB), DB-clock `updatedAt`. |

Data model: `workspace_file` (`id, user_id, name, type 'folder'|'file',
parent_id, position, created_at, updated_at`) + `note` (`id, file_id UNIQUE,
user_id, content, created_at, updated_at`). Migration
`1732000000000-CreateNotesWorkspace` (TypeORM-owned domain tables, PRD D2 —
plain string `user_id`, no cross-ORM FKs). Sibling-name uniqueness is a
case-insensitive expression index (`uq_workspace_file_sibling_name`).

Content is stored verbatim and never executed server-side — rendering and
sanitization are the client's responsibility.

Governance docs (PRD, ARCHITECTURE, ROADMAP, TASKS, LOG, MEMORY) live in `../Brain/`.
For "how do I actually use this" — sign-ups, resets, admin workflows, troubleshooting — see `../Brain/RUNBOOK.md`.
