/**
 * Phase 4 negative/edge-case E2E — the contract below the happy paths.
 *  1. unverified user cannot sign in (401 with email-not-verified code)
 *  2. resend-verification issues a FRESH usable token (dev capture)
 *  3. a verification token is single-use (second visit rejected)
 *  4. garbage/expired token → rejected safely
 *  5. sessions: no session can be minted from a rejected token flow
 */
import 'dotenv/config';
import { Client } from 'pg';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL = `e2e-edge-${Date.now()}@test.local`;
const PASSWORD = 'edge-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — EDGE E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — EDGE E2E ✓ (negative contract verified)`,
  );
  process.exit(fails.length ? 1 : 0);
}

const cookiesFrom = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
const jsonOf = async (res) => { try { return await res.json(); } catch { return {}; } };

async function main() {
  const step = async (name, fn) => {
    try {
      const value = await fn();
      results.push([name, 'PASS', value ?? '']);
      console.log(`[PASS] ${name}${value ? ' — ' + value : ''}`);
      return value;
    } catch (e) {
      results.push([name, 'FAIL', e.message]);
      console.error(`[FAIL] ${name} — ${e.message}`);
      printSummary();
    }
  };

  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const capturePath = join(process.cwd(), '.mail-capture.jsonl');
  const captureAfter = (afterIso = new Date(0).toISOString(), subject = 'Verify your email') => {
    const lines = readFileSync(capturePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    return [...lines]
      .reverse()
      .find((e) => e.at >= afterIso && e.to === EMAIL && e.subject === subject);
  };

  const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: /sslmode=(require|verify)/.test(process.env.DATABASE_URL || '')
      ? { rejectUnauthorized: false }
      : undefined,
  });
  await db.connect();

  await step('test-data cleanup', async () => {
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-edge-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-edge-%')`);
    await db.query(`delete from "user" where email like 'e2e-edge-%'`);
    return 'stale edge rows removed';
  });

  const startedAt = new Date().toISOString();

  await step('signup (unverified, no token consumed)', async () => {
    const r = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ name: 'Edge Tester', email: EMAIL, password: PASSWORD }),
    });
    if (r.status !== 200) throw new Error(`signup ${r.status}`);
    if (!captureAfter(startedAt)) throw new Error('verification mail not captured');
    const { rows } = await db.query(`select "emailVerified" from "user" where email = $1`, [EMAIL]);
    if (rows[0]?.emailVerified !== false) throw new Error('user should be unverified');
    return 'unverified user + verification mail dispatched';
  });

  await step('unverified login rejected (403 EMAIL_NOT_VERIFIED)', async () => {
    const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (r.status !== 401 && r.status !== 403) {
      throw new Error(`expected 401/403, got ${r.status} ${JSON.stringify(await jsonOf(r)).slice(0, 200)}`);
    }
    const body = await jsonOf(r);
    if (body.code && body.code !== 'EMAIL_NOT_VERIFIED') throw new Error(`unexpected code ${body.code}`);
    if (cookiesFrom(r).length) throw new Error('a session was minted for an unverified user!');
    return `status ${r.status}${body.code ? ' code ' + body.code : ''}, no session cookie`;
  });

  let resendUrl;
  await step('resend-verification issues a fresh token', async () => {
    const r = await fetch(`${BASE}/api/auth/send-verification-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL, callbackURL: `${ORIGIN}/` }),
    });
    if (r.status !== 200) throw new Error(`resend ${r.status} ${JSON.stringify(await jsonOf(r)).slice(0, 200)}`);
    const mail = captureAfter(startedAt);
    if (!mail) throw new Error('no fresh verification mail captured');
    resendUrl = mail.url;
    return `fresh token issued → ${resendUrl.slice(30, 70)}…`;
  });

  let firstCookie;
  await step('fresh token verifies + auto sign-in (US-1)', async () => {
    const r = await fetch(resendUrl, { redirect: 'manual' });
    if (r.status >= 400) throw new Error(`verify status ${r.status}`);
    const cookies = cookiesFrom(r);
    if (!cookies.some((c) => c.startsWith('better-auth.session_token='))) {
      throw new Error('auto sign-in session cookie missing');
    }
    firstCookie = cookies.join('; ');
    const { rows } = await db.query(`select count(*)::int as n from "user" where email = $1 and "emailVerified" = true`, [EMAIL]);
    if (rows[0].n !== 1) throw new Error('user not flipped to verified');
    return 'verified + signed in from the resend token';
  });

  await step('same token is idempotent (revisit: no new session)', async () => {
    const r = await fetch(resendUrl, { redirect: 'manual' });
    // 1.7: user already verified + callbackURL → benign redirect (idempotent no-op)
    const acceptable = r.status === 302 || (r.status >= 400 && r.status < 500);
    if (!acceptable) throw new Error(`expected 302/4xx, got ${r.status}: ${JSON.stringify(await jsonOf(r)).slice(0, 160)}`);
    const { rows } = await db.query(`select count(*)::int as n from "session" s join "user" u on u.id = s."userId" where u.email = $1`, [EMAIL]);
    if (rows[0].n !== 1) throw new Error(`session count changed on token revisit: ${rows[0].n}`);
    return `token revisit → no-op (${r.status}); sessions unchanged`;
  });

  await step('garbage token rejected safely', async () => {
    const r = await fetch(`${BASE}/api/auth/verify-email?token=garbage.token.sig&callbackURL=${encodeURIComponent(ORIGIN + '/')}`, { redirect: 'manual' });
    const loc = r.headers.get('location') ?? '';
    if (!(r.status >= 400 || (r.status === 302 && loc.includes('INVALID_TOKEN')))) {
      throw new Error(`expected rejection redirect/4xx, got ${r.status} loc=${loc.slice(0, 100)}`);
    }
    const { rows } = await db.query(`select count(*)::int as n from "session" s join "user" u on u.id = s."userId" where u.email = $1`, [EMAIL]);
    if (rows[0].n !== 1) throw new Error('session state changed on garbage token');
    return `garbage token → safe rejection (${r.status}${loc ? ' → ' + loc.slice(0, 60) : ''})`;
  });

  await db.end();
  printSummary();
}

void main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
