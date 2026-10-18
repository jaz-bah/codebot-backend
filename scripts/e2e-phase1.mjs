/**
 * Phase 1 scripted HTTP E2E — signup → verify (auto sign-in) → sign-out →
 * sign-in → session → sign-out.
 *
 * BetterAuth 1.7 verification tokens are stateless JWTs in the emailed URL;
 * in non-production MailService also appends sends to `.mail-capture.jsonl`,
 * which this script reads instead of a mailbox.
 *
 * NOTE: `autoSignInAfterVerification` creates a session AT VERIFICATION TIME.
 * Sign-out revokes only the session identified by the cookie — asserted per
 * step against the exact tokens created in this run.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL = `e2e-phase1-${Date.now()}@test.local`;
const PASSWORD = 'test1234password';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — PHASE 1 E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — PHASE 1 E2E ✓ (US-1 flow: signup→verify(auto-signin)→signout→signin→session→signout)`,
  );
  process.exit(fails.length ? 1 : 0);
}

function cookiesFrom(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(';')[0]);
}

function sessionRowCount(db) {
  return db.query(
    `select count(*)::int as n from "session" s join "user" u on u.id = s."userId" where u."email" = $1`,
    [EMAIL],
  );
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
  await step('test-data cleanup (previous runs)', async () => {
    await db.query(
      `delete from "session" where "userId" in (select id from "user" where email like 'e2e-phase1-%' or email like 'so-test-%' or email like 'so-http-%')`,
    );
    await db.query(
      `delete from "account" where "userId" in (select id from "user" where email like 'e2e-phase1-%' or email like 'so-test-%' or email like 'so-http-%')`,
    );
    await db.query(
      `delete from "user" where email like 'e2e-phase1-%' or email like 'so-test-%' or email like 'so-http-%'`,
    );
    return 'stale test users/sessions removed';
  });

  // 1. Signup (unverified)
  await step('sign-up → 200, no session issued', async () => {
    const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ name: 'E2E Phase1', email: EMAIL, password: PASSWORD }),
    });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`status ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    if (body.user?.emailVerified !== false) throw new Error('user should be emailVerified=false');
    if (body.token !== null) throw new Error('no session token should be issued before verification');
    return 'signup creates unverified user w/o session';
  });

  // 2. Verification mail (dev capture of the JWT-carrying URL)
  let verifyUrl;
  await step('verification email dispatched (dev mail capture)', async () => {
    const capturePath = join(process.cwd(), '.mail-capture.jsonl');
    let captured = null;
    for (let i = 0; i < 10 && !captured; i++) {
      try {
        const lines = readFileSync(capturePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        captured = [...lines]
          .reverse()
          .find((e) => e.to === EMAIL && (e.url ?? '').includes('verify-email'));
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (!captured) throw new Error('no captured verification mail in .mail-capture.jsonl');
    verifyUrl = captured.url;
    return `mail captured → ${verifyUrl.slice(0, 80)}…`;
  });

  // 3. Verify → emailVerified=true + auto sign-in cookie (US-1)
  let autoCookie = '';
  await step('verify-email → verified + auto sign-in session', async () => {
    const res = await fetch(verifyUrl, { redirect: 'manual' });
    if (res.status >= 400) throw new Error(`verify-email status ${res.status}`);
    const { rows } = await db.query(
      `select count(*)::int as n from "user" where "email" = $1 and "emailVerified" = true`,
      [EMAIL],
    );
    if (rows[0].n !== 1) throw new Error('user not emailVerified after verify-email');
    const cookies = cookiesFrom(res);
    if (!cookies.some((x) => x.startsWith('better-auth.session_token='))) {
      throw new Error(`autoSignInAfterVerification did not set a session cookie (${cookies.length})`);
    }
    autoCookie = cookies.join('; ');
    return 'emailVerified=true, auto-signin session cookie issued';
  });

  // 4. get-session with the auto-signin cookie
  await step('get-session works immediately after verification', async () => {
    const res = await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: autoCookie } });
    const body = await res.json();
    if (res.status !== 200 || body?.user?.email !== EMAIL) {
      throw new Error(`get-session failed: ${res.status} ${JSON.stringify(body ?? {}).slice(0, 150)}`);
    }
    return `session=${body.session ? 'present' : 'absent'} for ${body.user.email}`;
  });

  // 5. Sign out (auto session) — exact token created in this run must vanish
  await step('sign-out (auto session) → 0 sessions in DB', async () => {
    const res = await fetch(`${BASE}/api/auth/sign-out`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: autoCookie, origin: ORIGIN },
      body: '{}',
    });
    if (res.status !== 200) throw new Error(`sign-out status ${res.status}`);
    const { rows } = await sessionRowCount(db);
    if (rows[0].n !== 0) throw new Error(`expected 0 sessions, DB has ${rows[0].n}`);
    return 'auto session row deleted (FR-6)';
  });

  // 6. Verified user can now log in normally
  let loginCookie = '';
  await step('sign-in (post-verification) → session cookie', async () => {
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (res.status !== 200) throw new Error(`sign-in status ${res.status}`);
    const cookies = cookiesFrom(res);
    if (!cookies.some((c) => c.startsWith('better-auth.session_token='))) {
      throw new Error(`no session cookie in: ${cookies.join(', ')}`);
    }
    loginCookie = cookies.join('; ');
    return 'httpOnly session cookie issued';
  });

  // 7. Session readable + role default
  await step('get-session returns the user (role=user)', async () => {
    const res = await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: loginCookie } });
    const body = await res.json();
    if (res.status !== 200 || body?.user?.email !== EMAIL) {
      throw new Error(`get-session failed: ${res.status} ${JSON.stringify(body ?? {}).slice(0, 150)}`);
    }
    if (body.user.role !== 'user') throw new Error(`role should be 'user', got ${body.user.role}`);
    return `session for ${body.user.email}`;
  });

  // 8. Sign-out revokes the login session
  await step('sign-out (login session) → 0 sessions in DB', async () => {
    const res = await fetch(`${BASE}/api/auth/sign-out`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: loginCookie, origin: ORIGIN },
      body: '{}',
    });
    if (res.status !== 200) throw new Error(`sign-out status ${res.status}`);
    const { rows } = await sessionRowCount(db);
    if (rows[0].n !== 0) throw new Error(`expected 0 sessions after sign-out, DB has ${rows[0].n}`);
    return 'cookie invalidated, session row deleted (FR-6)';
  });

  await db.end();
  printSummary();
}

void main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
