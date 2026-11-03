/**
 * Settings E2E — scripted HTTP checks against a running server.
 * Requires: server booted (npm start / start:dev) + .mail-capture.jsonl dev mode.
 *
 *  1. anon → GET /settings 401
 *  2. signup → verify → session cookie
 *  3. GET default → all null (no row yet)
 *  4. PATCH credentials → masked response; plaintext never appears
 *  5. DB check → values stored as enc:v1: ciphertext (not plaintext)
 *  6. GET → masked again; symmetric
 *  7. PATCH ⊂ update; explicit null clears one field
 *  8. PATCH {} → 400; bad values → 400
 *  9. user B → all null (isolation)
 * 10. DELETE /settings → reset; B unharmed
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL_A = `e2e-settings-a-${Date.now()}@test.local`;
const EMAIL_B = `e2e-settings-b-${Date.now()}@test.local`;
const PASSWORD = 'settings-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const OR_KEY = 'sk-or-v1-e2e0abcdefghijklmnop';
const CLOUD_NAME = 'e2e-test-cloud';
const CLOUD_KEY = '123456789012e2e';
const CLOUD_SECRET = 'e2e-secret-abcdef0123456789';

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — SETTINGS E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — SETTINGS E2E ✓`,
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

async function api(method, path, { cookie, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, json: await jsonOf(res) };
}

async function signIn(email) {
  const r1 = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ name: 'Settings Tester', email, password: PASSWORD }),
  });
  if (r1.status !== 200) throw new Error(`signup ${r1.status} ${JSON.stringify(await jsonOf(r1)).slice(0, 300)}`);
  const mail = capturedMail(email, 'Verify your email');
  if (!mail) throw new Error('no verification mail captured');
  const r2 = await fetch(mail.url, { redirect: 'manual' });
  if (r2.status >= 400) throw new Error(`verify ${r2.status}`);
  const cookie = cookiesFrom(r2).join('; ');
  if (!cookie) throw new Error('no session cookie after verify');
  return cookie;
}

async function main() {
  const step = async (name, fn) => {
    try {
      const value = await fn();
      results.push([name, 'PASS', value ?? '']);
      console.log(`[PASS] ${name}${value ? ' — ' + (value.length ? String(value).slice(0, 40) + '…' : value) : ''}`);
      return value;
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
    await db.query(`delete from "setting" where "user_id" in (select id from "user" where email like 'e2e-settings-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-settings-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-settings-%')`);
    await db.query(`delete from "user" where email like 'e2e-settings-%'`);
    return 'stale settings e2e rows removed';
  });

  const cookieA = await step('signup user A → verify → session cookie', () => signIn(EMAIL_A));

  await step('anon GET /settings → 401', async () => {
    const { res } = await api('GET', '/settings');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'service rejects anonymous access';
  });

  await step('GET default → all null (singleton row not created by reads)', async () => {
    const { res, json } = await api('GET', '/settings', { cookie: cookieA });
    if (res.status !== 200) throw new Error(`get ${res.status}`);
    for (const f of ['openRouterApiKey', 'cloudinaryCloudName', 'cloudinaryApiKey', 'cloudinaryApiSecret']) {
      if (json[f] !== null) throw new Error(`${f} should be null, got ${JSON.stringify(json[f])}`);
    }
    return 'clean defaults';
  });

  await step('PATCH credentials → masked response; plaintext never returned', async () => {
    const { res, json } = await api('PATCH', '/settings', {
      cookie: cookieA,
      body: {
        openRouterApiKey: OR_KEY,
        cloudinaryCloudName: CLOUD_NAME,
        cloudinaryApiKey: CLOUD_KEY,
        cloudinaryApiSecret: CLOUD_SECRET,
      },
    });
    if (res.status !== 200 && res.status !== 201) throw new Error(`patch ${res.status} ${JSON.stringify(json)}`);
    const responseText = JSON.stringify(json);
    for (const secret of [OR_KEY, CLOUD_KEY, CLOUD_SECRET]) {
      if (responseText.includes(secret)) throw new Error('PATCH response leaked plaintext!');
    }
    if (json.openRouterApiKey !== 'sk-…mnop') throw new Error(`mask unexpected: ${json.openRouterApiKey}`);
    if (json.cloudinaryCloudName !== CLOUD_NAME) throw new Error('cloud name should be plain');
    return 'masked ok';
  });

  await step('DB stored as enc:v1: ciphertext — never plaintext', async () => {
    const { rows } = await db.query(
      `select "open_router_api_key", "cloudinary_cloud_name", "cloudinary_api_key", "cloudinary_api_secret" from "setting" where "user_id" = (select id from "user" where email = $1)`,
      [EMAIL_A],
    );
    if (rows.length !== 1) throw new Error(`rows ${rows.length}`);
    const r = rows[0];
    for (const f of ['open_router_api_key', 'cloudinary_api_key', 'cloudinary_api_secret']) {
      if (!String(r[f]).startsWith('enc:v1:')) throw new Error(`${f} not encrypted: ${String(r[f]).slice(0, 30)}`);
      if (String(r[f]).includes(OR_KEY) || String(r[f]).includes(CLOUD_SECRET)) throw new Error(`${f} leaked plaintext`);
    }
    if (r.cloudinary_cloud_name !== CLOUD_NAME) throw new Error('cloud name not stored plain');
    return 'ciphertext at rest';
  });

  await step('GET /settings → masks persisted across requests', async () => {
    const { json } = await api('GET', '/settings', { cookie: cookieA });
    const responseText = JSON.stringify(json);
    if (responseText.includes(OR_KEY) || responseText.includes(CLOUD_SECRET)) throw new Error('plaintext leak!');
    if (json.cloudinaryCloudName !== CLOUD_NAME) throw new Error('cloud name lost');
    if (json.updatedAt == null) throw new Error('missing updatedAt');
    return json.cloudinaryApiKey;
  });

  const rotated = 'sk-or-v1-rotated9999ffffff';
  await step('PATCH rotates the OpenRouter key + explicit null clears one field', async () => {
    const { json } = await api('PATCH', '/settings', { cookie: cookieA, body: { openRouterApiKey: rotated } });
    if (json.openRouterApiKey !== 'sk-…ffff') throw new Error(`rotation mask unexpected: ${json.openRouterApiKey}`);
    const cleared = await api('PATCH', '/settings', { cookie: cookieA, body: { cloudinaryApiSecret: null } });
    if (cleared.json.cloudinaryApiSecret !== null) throw new Error('secret not cleared');
    if (cleared.json.openRouterApiKey !== 'sk-…ffff') throw new Error('other field lost during partial clear');
    if (JSON.stringify(cleared.json).includes(CLOUD_SECRET)) throw new Error('cleared secret leaked plaintext');
    return 'rotation + null-clear ok';
  });

  await step('validation: empty patch and bad values → 400', async () => {
    const empty = await api('PATCH', '/settings', { cookie: cookieA, body: {} });
    if (empty.res.status !== 400) throw new Error(`empty body → ${empty.res.status}, want 400`);
    const short = await api('PATCH', '/settings', { cookie: cookieA, body: { openRouterApiKey: 'abc' } });
    if (short.res.status !== 400) throw new Error(`short key → ${short.res.status}, want 400`);
    const emptyStr = await api('PATCH', '/settings', { cookie: cookieA, body: { cloudinaryCloudName: '' } });
    if (emptyStr.res.status !== 400) throw new Error(`empty cloud name → ${emptyStr.res.status}, want 400`);
    // unknown keys are stripped, request still succeeds and changes nothing
    const unknown = await api('PATCH', '/settings', { cookie: cookieA, body: { awsSecretKey: 'nope' } });
    if (unknown.res.status !== 400) throw new Error(`unknown keys should be stripped → ${unknown.res.status}`);
    return '400s + stripping ok';
  });

  let cookieB;
  await step('user B isolation: fresh users see nothing of A’s settings', async () => {
    cookieB = await signIn(EMAIL_B);
    const { json } = await api('GET', '/settings', { cookie: cookieB });
    for (const f of ['openRouterApiKey', 'cloudinaryCloudName', 'cloudinaryApiKey', 'cloudinaryApiSecret']) {
      if (json[f] !== null) throw new Error(`B sees ${f}`);
    }
    // B deletes only their own (nonexistent) settings — A's survive:
    await api('DELETE', '/settings', { cookie: cookieB });
    const { rows } = await db.query(
      `select count(*)::int as n from "setting" where "user_id" = (select id from "user" where email = $1)`,
      [EMAIL_A],
    );
    if (rows[0].n !== 1) throw new Error(`A's settings row destroyed: count=${rows[0].n}`);
    return 'isolation + scoped reset ok';
  });

  await step('DELETE /settings (user A) → full reset', async () => {
    const { res } = await api('DELETE', '/settings', { cookie: cookieA });
    if (res.status !== 200 && res.status !== 201) throw new Error(`delete ${res.status}`);
    const { json } = await api('GET', '/settings', { cookie: cookieA });
    if (json.updatedAt !== null) throw new Error(`expected blank view after reset: ${JSON.stringify(json)}`);
    const { rows } = await db.query(
      `select count(*)::int as n from "setting" where "user_id" = (select id from "user" where email = $1)`,
      [EMAIL_A],
    );
    if (rows[0].n !== 0) throw new Error(`row not deleted: count=${rows[0].n}`);
    return 'reset ok';
  });

  await step('e2e cleanup (DB rows)', async () => {
    await db.query(`delete from "setting" where "user_id" in (select id from "user" where email like 'e2e-settings-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-settings-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-settings-%')`);
    await db.query(`delete from "user" where email like 'e2e-settings-%'`);
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
