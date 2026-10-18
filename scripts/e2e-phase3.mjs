/**
 * Phase 3 scripted HTTP E2E — password reset + Nest guard surface.
 *
 *  1. signup → verify (auto sign-in) → sign-out        (fresh verified user)
 *  2. forget-password → reset via captured mail token  (sessions revoked)
 *  3. old password fails, new password works
 *  4. Nest routes: /admin/stats 401 (anon) → 403 (user) + audit row
 *  5. better-auth rate limit: 4x bad sign-in → 429 (special rule 3/10s)
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL = `e2e-phase3-${Date.now()}@test.local`;
const OLD_PASSWORD = 'old-password-123';
const NEW_PASSWORD = 'new-password-456';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — PHASE 3 E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — PHASE 3 E2E ✓ (reset flow + guards + audit + rate limit)`,
  );
  process.exit(fails.length ? 1 : 0);
}

const cookiesFrom = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
const jsonOf = async (res) => {
  try { return await res.json(); } catch { return {}; }
};

function capturedMail(to, subject) {
  const capture = join(process.cwd(), '.mail-capture.jsonl');
  const lines = readFileSync(capture, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return [...lines].reverse().find((e) => e.to === to && e.subject === subject && (e.url ?? '').length > 0);
}

async function main() {
  const step = async (name, fn) => {
    try {
      const value = await fn();
      results.push([name, 'PASS', value ?? '']);
      console.log(`[PASS] ${name}${value ? ' — ' + value : ''}`);
    } catch (e) {
      results.push([name, 'FAIL', e.message]);
      console.error(`[FAIL] ${name} — ${e.message}`);
      printSummary();
    }
  };

  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: /sslmode=(require|verify)/.test(process.env.DATABASE_URL || '')
      ? { rejectUnauthorized: false }
      : undefined,
  });
  await db.connect();

  await step('test-data cleanup', async () => {
    await db.query(
      `delete from "session" where "userId" in (select id from "user" where email like 'e2e-phase3-%')`,
    );
    await db.query(
      `delete from "account" where "userId" in (select id from "user" where email like 'e2e-phase3-%')`,
    );
    await db.query(`delete from "user" where email like 'e2e-phase3-%'`);
    await db.query(`delete from "audit_log" where "email" like 'e2e-phase3-%'`);
    return 'stale phase3 rows removed';
  });

  // 1–3. verified user with OLD_PASSWORD
  let cookie;
  await step('signup → verify → auto-signup cookie revoked', async () => {
    const r1 = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ name: 'Phase3 Tester', email: EMAIL, password: OLD_PASSWORD }),
    });
    if (r1.status !== 200) throw new Error(`signup ${r1.status} ${JSON.stringify(await jsonOf(r1)).slice(0, 200)}`);
    const mail = capturedMail(EMAIL, 'Verify your email');
    if (!mail) throw new Error('no verification mail captured');
    const r2 = await fetch(mail.url, { redirect: 'manual' });
    if (r2.status >= 400) throw new Error(`verify ${r2.status}`);
    const { rows } = await db.query(`select count(*)::int as n from "session" s join "user" u on u.id = s."userId" where u.email = $1`, [EMAIL]);
    if (rows[0].n !== 1) throw new Error('expected auto-signin session');
    const r3 = await fetch(`${BASE}/api/auth/sign-out`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookiesFrom(r2).join('; '), origin: ORIGIN },
      body: '{}',
    });
    if (r3.status !== 200) throw new Error(`sign-out ${r3.status}`);
    return 'verified user created with OLD password, fully signed out';
  });

  // 2. forget-password → reset with captured token
  await step('forget-password → reset-password → 0 sessions remain', async () => {
    const r1 = await fetch(`${BASE}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL }),
    });
    if (r1.status !== 200) throw new Error(`forget-password ${r1.status} ${JSON.stringify(await jsonOf(r1)).slice(0, 200)}`);
    const mail = capturedMail(EMAIL, 'Reset your password');
    if (!mail) throw new Error('reset mail not captured');
    // 1.7 URL shape: /api/auth/reset-password/<token>?callbackURL=…
    const token = new URL(mail.url).pathname.split('/reset-password/')[1]?.split('?')[0];
    if (!token) throw new Error('reset URL missing token (path segment)');
    const r2 = await fetch(`${BASE}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ newPassword: NEW_PASSWORD, token }),
    });
    if (r2.status !== 200) throw new Error(`reset ${r2.status} ${JSON.stringify(await jsonOf(r2)).slice(0, 200)}`);
    const { rows } = await db.query(
      `select count(*)::int as n from "session" s join "user" u on u.id = s."userId" where u.email = $1`, [EMAIL],
    );
    if (rows[0].n !== 0) throw new Error(`sessions survived reset: ${rows[0].n}`);
    return 'password changed, all sessions revoked (revokeSessionsOnPasswordReset)';
  });

  // 3. old fails, new works
  await step('old password rejected; new password accepted', async () => {
    const bad = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL, password: OLD_PASSWORD }),
    });
    if (bad.status !== 401) throw new Error(`old password gave ${bad.status}, want 401`);
    const good = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL, password: NEW_PASSWORD }),
    });
    if (good.status !== 200) throw new Error(`new password gave ${good.status}`);
    cookie = cookiesFrom(good).join('; ');
    return 'credential rotation works';
  });

  // 4. Nest guards
  await step('GET /admin/stats anon → 401 (Nest guard layer)', async () => {
    const res = await fetch(`${BASE}/admin/stats`);
    if (res.status !== 401) throw new Error(`anon /admin/stats gave ${res.status}, want 401`);
    const body = await jsonOf(res);
    if (body.statusCode !== 401 || !body.timestamp) throw new Error(`non-uniform envelope: ${JSON.stringify(body).slice(0, 160)}`);
    return 'uniform error envelope: ' + JSON.stringify(body).slice(0, 60);
  });

  await step('GET /admin/stats non-admin user → 403 + audit row', async () => {
    const res = await fetch(`${BASE}/admin/stats`, { headers: { cookie, origin: ORIGIN } });
    if (res.status !== 403) throw new Error(`user /admin/stats gave ${res.status}, want 403`);
    const { rows } = await db.query(
      `select count(*)::int as n from "audit_log" where "email" = $1 and "action" = 'ACCESS_DENIED'`, [EMAIL],
    );
    if (rows[0].n < 1) throw new Error(`audit_log missing ACCESS_DENIED row for ${EMAIL}`);
    return `403 + audit row written (details sanitized)`;
  });

  // 5. BetterAuth rate limit — special rule: sign-in 3/10s
  await step('better-auth rate limit → 429 on 4th sign-in attempt (3/10s)', async () => {
    const attempts = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: `wrong-${EMAIL}`, password: 'nope12345' }),
      });
      attempts.push(res.status);
      if (res.status === 429) break;
    }
    if (attempts[attempts.length - 1] !== 429) throw new Error(`expected a 429, got ${attempts.join(',')}`);
    return `attempt statuses: ${attempts.join(', ')}`;
  });

  await db.end();
  printSummary();
}

void main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
