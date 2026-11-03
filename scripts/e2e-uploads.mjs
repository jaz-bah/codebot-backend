/**
 * Uploads E2E — scripted HTTP checks against a running server.
 * Requires: server booted + .mail-capture.jsonl dev mode.
 *
 * Uses deliberately INVALID Cloudinary credentials, so the success path is
 * covered by unit tests (mocked fetch); here we prove the HTTP surface:
 *
 *  1. anon → POST /uploads/images 401
 *  2. signup → verify → session cookie
 *  3. POST image WITHOUT configured creds → 400 "not configured"
 *  4. POST zip WITHOUT configured creds → 400 "not configured"
 *  5. configure (fake) Cloudinary creds via PATCH /settings
 *  6. POST valid PNG → validation passes → upstream fails → 502 mapped
 *  7. POST valid ZIP → same (raw endpoint)
 *  8. POST text file named .png → 400 "does not look like a supported image"
 *  9. POST 10MB+1 image → 413
 * 10. POST without a file field → 400 "file is required"
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL = `e2e-uploads-${Date.now()}@test.local`;
const PASSWORD = 'uploads-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — UPLOADS E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — UPLOADS E2E ✓`,
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

async function signIn(email) {
  const r1 = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ name: 'Uploads Tester', email, password: PASSWORD }),
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

const upload = async (cookie, path, buffer, filename, mime) => {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body: form,
  });
  return { res, json: await jsonOf(res) };
};

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(16).fill(0)]);
const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array(16).fill(0)]);
const TEXT_BYTES = Buffer.from('plain text pretending to be a png');

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
    await db.query(`delete from "setting" where "user_id" in (select id from "user" where email like 'e2e-uploads-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-uploads-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-uploads-%')`);
    await db.query(`delete from "user" where email like 'e2e-uploads-%'`);
    return 'stale uploads e2e rows removed';
  });

  const cookie = await step('signup → verify → session cookie', () => signIn(EMAIL));

  await step('anon POST /uploads/images → 401', async () => {
    const { res } = await upload(null, '/uploads/images', PNG_BYTES, 'anon.png', 'image/png');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'service rejects anonymous access';
  });

  await step('POST image WITHOUT configured Cloudinary creds → 400 "not configured"', async () => {
    const { res, json } = await upload(cookie, '/uploads/images', PNG_BYTES, 'photo.png', 'image/png');
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}: ${JSON.stringify(json)}`);
    if (!String(json.message).includes('Cloudinary credentials are not configured')) {
      throw new Error(`unexpected message: ${json.message}`);
    }
    return 'credential gating ok';
  });

  await step('POST zip WITHOUT configured Cloudinary creds → 400 "not configured"', async () => {
    const { res } = await upload(cookie, '/uploads/zips', ZIP_BYTES, 'archive.zip', 'application/zip');
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
    return 'credential gating ok (zip)';
  });

  await step('configure (fake) Cloudinary creds via PATCH /settings', async () => {
    const res = await fetch(`${BASE}/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie },
      body: JSON.stringify({
        cloudinaryCloudName: 'e2e-definitely-invalid-cloud',
        cloudinaryApiKey: 'e2e-fake-key-1234',
        cloudinaryApiSecret: 'e2e-fake-secret-5678',
      }),
    });
    if (res.status !== 200 && res.status !== 201) throw new Error(`patch ${res.status}`);
    return 'fake creds stored (encrypted at rest)';
  });

  await step('POST valid PNG → validation passes → upstream rejected → 502', async () => {
    const { res, json } = await upload(cookie, '/uploads/images', PNG_BYTES, 'photo.png', 'image/png');
    if (res.status !== 502) throw new Error(`expected 502 (invalid upstream creds), got ${res.status}: ${JSON.stringify(json)}`);
    if (!String(json.message).includes('Cloudinary upload failed')) throw new Error(`unexpected message: ${json.message}`);
    return 'upstream error mapped, no internal leak';
  });

  await step('POST valid ZIP → same raw-endpoint flow → 502', async () => {
    const { res } = await upload(cookie, '/uploads/zips', ZIP_BYTES, 'archive.zip', 'application/zip');
    if (res.status !== 502) throw new Error(`expected 502, got ${res.status}`);
    return 'zip validation + upstream mapping ok';
  });

  await step('POST text file named .png → 400 "does not look like a supported image"', async () => {
    const { res, json } = await upload(cookie, '/uploads/images', TEXT_BYTES, 'fake.png', 'image/png');
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
    if (!String(json.message).includes('does not look like a supported image')) throw new Error(`unexpected message: ${json.message}`);
    return 'magic-byte validation ok';
  });

  await step('POST 10MB+1 image → 413', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x00);
    const { res } = await upload(cookie, '/uploads/images', big, 'big.png', 'image/png');
    if (res.status !== 413) throw new Error(`expected 413, got ${res.status}`);
    return 'size cap ok';
  });

  await step('POST without a file field → 400 "file is required"', async () => {
    const form = new FormData();
    form.append('notFile', 'nope');
    const res = await fetch(`${BASE}/uploads/images`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie },
      body: form,
    });
    const json = await jsonOf(res);
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}: ${JSON.stringify(json)}`);
    if (!String(json.message).includes('file is required')) throw new Error(`unexpected message: ${json.message}`);
    return 'missing file ok';
  });

  await step('e2e cleanup (DB rows)', async () => {
    await db.query(`delete from "setting" where "user_id" in (select id from "user" where email like 'e2e-uploads-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-uploads-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-uploads-%')`);
    await db.query(`delete from "user" where email like 'e2e-uploads-%'`);
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
