/**
 * Tools E2E — scripted HTTP checks against a running server.
 * Requires: server booted (npm start / start:dev) + .mail-capture.jsonl dev mode.
 *
 *  1. anon → GET /tools 401
 *  2. signup → verify → session cookie
 *  3. create ×5 (required fields, uuid ids, timestamps)
 *  4. pagination (page/limit/total/totalPages)
 *  5. search over name AND description (protected ILIKE wildcards)
 *  6. sorting (name asc default, createdAt)
 *  7. update + updatedAt stamping
 *  8. validation errors (400: empty patch, bad URL, bad params) and 404 semantics
 *  9. delete
 * 10. second user → cannot see/modify first user's tools (isolation)
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL_A = `e2e-tools-a-${Date.now()}@test.local`;
const EMAIL_B = `e2e-tools-b-${Date.now()}@test.local`;
const PASSWORD = 'tools-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — TOOLS E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — TOOLS E2E ✓`,
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
    body: JSON.stringify({ name: 'Tools Tester', email, password: PASSWORD }),
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
    await db.query(`delete from "tool" where "user_id" in (select id from "user" where email like 'e2e-tools-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-tools-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-tools-%')`);
    await db.query(`delete from "user" where email like 'e2e-tools-%'`);
    return 'stale tools e2e rows removed';
  });

  const cookieA = await step('signup user A → verify → session cookie', () => signIn(EMAIL_A));

  await step('anon GET /tools → 401', async () => {
    const { res } = await api('GET', '/tools');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'service rejects anonymous access';
  });

  const toolIds = [];
  await step('create ×5 → uuid ids with name/description landmarks', async () => {
    for (const i of [1, 2, 3, 4, 5]) {
      const { res, json } = await api('POST', '/tools', {
        cookie: cookieA,
        body: {
          name: i === 2 ? `Tool ${i}` : `Zip Tool ${i}`,
          description: i === 3 ? 'FindMe alpha tool' : null,
          downloadLink: `https://example.com/download/tool-${i}`,
        },
      });
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`create ${i} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
      }
      if (!json.id || json.downloadLink !== `https://example.com/download/tool-${i}`) {
        throw new Error(`bad payload ${JSON.stringify(json).slice(0, 150)}`);
      }
      if (json.createdAt == null || json.updatedAt == null) {
        throw new Error('missing timestamps');
      }
      toolIds.push({ id: json.id, name: json.name });
    }
    return '5 tools created with timestamps';
  });

  await step('create with invalid download link → 400', async () => {
    for (const link of ['not-a-url', 'ftp://example.com/file', 'example.com/file.exe']) {
      const { res } = await api('POST', '/tools', {
        cookie: cookieA,
        body: { name: 'Bad tool', downloadLink: link },
      });
      if (res.status !== 400) throw new Error(`bad link "${link}" → expected 400, got ${res.status}`);
    }
    const missing = await api('POST', '/tools', { cookie: cookieA, body: { name: 'No link' } });
    if (missing.res.status !== 400) throw new Error(`missing link → ${missing.res.status}`);
    return 'invalid/missing download link rejected';
  });

  await step('pagination: default list → total 5', async () => {
    const { res, json } = await api('GET', '/tools', { cookie: cookieA });
    if (res.status !== 200) throw new Error(`list ${res.status}`);
    if (json.total !== 5 || json.page !== 1 || json.limit !== 20) {
      throw new Error(`bad envelope ${JSON.stringify({ total: json.total, page: json.page, limit: json.limit })}`);
    }
    return 'total=5 page=1 limit=20';
  });

  await step('pagination: page 2 / limit 2 → totalPages 3', async () => {
    const { json } = await api('GET', '/tools?page=2&limit=2', { cookie: cookieA });
    if (json.total !== 5 || json.totalPages !== 3) throw new Error(`bad envelope ${JSON.stringify(json).slice(0, 150)}`);
    if (json.items.length !== 2 || json.page !== 2) throw new Error(`bad page shape ${JSON.stringify(json.items).slice(0, 100)}`);
    return 'page=2 limit=2 total=5 totalPages=3';
  });

  await step('query validation: bad params → 400', async () => {
    for (const q of ['?limit=1000', '?page=0', '?sortBy=hack', '?sortOrder=up']) {
      const { res } = await api('GET', `/tools${q}`, { cookie: cookieA });
      if (res.status !== 400) throw new Error(`${q} → expected 400, got ${res.status}`);
    }
    return 'limit/page/sortBy/sortOrder validated';
  });

  await step('search matches name AND description; wildcards escaped', async () => {
    const hitDesc = await api('GET', '/tools?search=findme', { cookie: cookieA });
    if (hitDesc.json.total !== 1) throw new Error(`description hit expected 1, got ${hitDesc.json.total}`);
    const hitName = await api('GET', '/tools?search=Tool%202', { cookie: cookieA });
    if (hitName.json.total !== 1) throw new Error(`name hit expected 1, got ${hitName.json.total}`);
    const wild = await api('GET', '/tools?search=Find%25Me', { cookie: cookieA });
    if (wild.json.total !== 0) throw new Error('unescaped wildcard matched');
    return '1 name hit, 1 description hit, 0 for wildcard';
  });

  await step('sort by name asc (default) and desc; createdAt desc default', async () => {
    const { json: nameAsc } = await api('GET', '/tools?sortBy=name&limit=1', { cookie: cookieA });
    // Lexicographic: "Tool 2" < "Zip Tool 1" (T < Z).
    if (nameAsc.items[0].name !== 'Tool 2') throw new Error(`name asc first was ${nameAsc.items[0].name}`);
    const { json: nameDesc } = await api('GET', '/tools?sortBy=name&sortOrder=desc&limit=1', { cookie: cookieA });
    if (nameDesc.items[0].name !== 'Zip Tool 5') throw new Error(`name desc first was ${nameDesc.items[0].name}`);
    const { json: defaultList } = await api('GET', '/tools', { cookie: cookieA });
    if (defaultList.items[0].name !== 'Zip Tool 5') throw new Error(`default sort first was ${defaultList.items[0].name}`);
    return 'name asc/desc + createdAt desc default';
  });

  let updatedTool;
  await step('PATCH /tools/:id updates fields + updatedAt', async () => {
    const target = toolIds[4];
    await api('PATCH', `/tools/${target.id}`, {
      cookie: cookieA,
      body: { name: 'Zip Tool 5 renamed', description: 'new tool', downloadLink: 'https://example.com/download/tool-5-v2' },
    });
    const after = await api('GET', `/tools/${target.id}`, { cookie: cookieA });
    if (after.json.name !== 'Zip Tool 5 renamed' || after.json.downloadLink !== 'https://example.com/download/tool-5-v2') {
      throw new Error(`patch not applied ${JSON.stringify(after.json)}`);
    }
    if (new Date(after.json.updatedAt) < new Date(after.json.createdAt)) throw new Error('updatedAt did not advance');
    updatedTool = after.json;
    return 'PATCH + GET single roundtrip ok';
  });

  await step('PATCH body validation → 400', async () => {
    const bad = await api('PATCH', `/tools/${updatedTool.id}`, { cookie: cookieA, body: {} });
    if (bad.res.status !== 400) throw new Error(`empty body → ${bad.res.status}, want 400`);
    const badUrl = await api('PATCH', `/tools/${updatedTool.id}`, { cookie: cookieA, body: { downloadLink: 'javascript:alert(1)' } });
    if (badUrl.res.status !== 400) throw new Error(`bad url → ${badUrl.res.status}`);
    return 'empty patch and invalid url rejected';
  });

  await step('GET /tools/:id 404 for a well-formed unknown uuid', async () => {
    const { res } = await api('GET', '/tools/9d9d8765-0000-4000-8000-000000000001', { cookie: cookieA });
    if (res.status !== 404) throw new Error(`unknown uuid → ${res.status}`);
    return '404 (not 403) for missing resource';
  });

  let cookieB;
  await step('user B isolation: B cannot read/modify A’s tools', async () => {
    cookieB = await signIn(EMAIL_B);
    const own = await api('GET', '/tools', { cookie: cookieB });
    if (own.json.total !== 0) throw new Error(`B sees ${own.json.total} of A's tools`);
    const foreign = await api('GET', `/tools/${updatedTool.id}`, { cookie: cookieB });
    if (foreign.res.status !== 404) throw new Error(`GET foreign → ${foreign.res.status}`);
    const patchForeign = await api('PATCH', `/tools/${updatedTool.id}`, { cookie: cookieB, body: { name: 'hacked' } });
    if (patchForeign.res.status !== 404) throw new Error(`PATCH foreign → ${patchForeign.res.status}`);
    const delForeign = await api('DELETE', `/tools/${updatedTool.id}`, { cookie: cookieB });
    if (delForeign.res.status !== 404) throw new Error(`DELETE foreign → ${delForeign.res.status}`);
    const uuidParam = await api('GET', '/tools/not-a-uuid', { cookie: cookieA });
    if (uuidParam.res.status !== 400) throw new Error(`invalid uuid → ${uuidParam.res.status}`);
    return 'full isolation (404 on read/patch/delete)';
  });

  await step('DELETE /tools/:id removes the row', async () => {
    const { res, json } = await api('DELETE', `/tools/${updatedTool.id}`, { cookie: cookieA });
    if (res.status !== 200 && res.status !== 201) throw new Error(`delete → ${res.status}`);
    if (json.deleted !== true) throw new Error(`bad delete payload ${JSON.stringify(json)}`);
    const gone = await api('GET', `/tools/${updatedTool.id}`, { cookie: cookieA });
    if (gone.res.status !== 404) throw new Error(`deleted row still readable → ${gone.res.status}`);
    const { rows } = await db.query(
      `select count(*)::int as n from "tool" where "user_id" = (select id from "user" where email = $1)`,
      [EMAIL_A],
    );
    if (rows[0].n !== 4) throw new Error(`DB count after delete = ${rows[0].n}`);
    return 'delete ok; DB count 4';
  });

  await step('e2e cleanup (DB rows)', async () => {
    await db.query(`delete from "tool" where "user_id" in (select id from "user" where email like 'e2e-tools-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-tools-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-tools-%')`);
    await db.query(`delete from "user" where email like 'e2e-tools-%'`);
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
