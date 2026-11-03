/**
 * Presets E2E — scripted HTTP checks against a running server.
 * Requires: server booted (npm start / start:dev) + .mail-capture.jsonl dev mode.
 *
 *  1. anon → GET /presets 401
 *  2. signup → verify → session cookie
 *  3. create ×5 across languages (uuid ids, timestamps)
 *  4. verbatim storage: multi-line code with tabs/%/\ survives a round trip
 *  5. create validation: missing name/language/data → 400
 *  6. pagination (page/limit/total/totalPages)
 *  7. query validation: bad params → 400
 *  8. search by name; LIKE wildcards escaped
 *  9. language filter (exact, composes with search)
 * 10. sorting (name asc default, explicit desc; createdAt asc AND desc)
 * 11. update + updatedAt stamping + data stays verbatim
 * 12. 404 semantics + PATCH validation
 * 13. second user → cannot see/modify first user's presets (isolation)
 * 14. delete
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL_A = `e2e-presets-a-${Date.now()}@test.local`;
const EMAIL_B = `e2e-presets-b-${Date.now()}@test.local`;
const PASSWORD = 'presets-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — PRESETS E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — PRESETS E2E ✓`,
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
    body: JSON.stringify({ name: 'Presets Tester', email, password: PASSWORD }),
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

// Verbatim multi-line payload: leading indent, internal blank line, tab,
// backslash, wildcard chars, unicode arrow, trailing spaces.
const VERBATIM_CODE =
  '.container {\n\talign: center;\n  margin: 0 auto; /* 100%_ \\ special */\n\n  inside => outside;\n}   \n  ';

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
    await db.query(`delete from "preset" where "user_id" in (select id from "user" where email like 'e2e-presets-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-presets-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-presets-%')`);
    await db.query(`delete from "user" where email like 'e2e-presets-%'`);
    return 'stale presets e2e rows removed';
  });

  const cookieA = await step('signup user A → verify → session cookie', () => signIn(EMAIL_A));

  await step('anon GET /presets → 401', async () => {
    const { res } = await api('GET', '/presets');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'service rejects anonymous access';
  });

  const presetIds = [];
  await step('create ×5 across css/js/py/html/svg languages', async () => {
    // i === 2 gets the lexicographically small name "Preset 2"; others are
    // "Zeta Preset i" so both name-sort directions are distinguishable.
    const dtos = [
      { name: 'Zeta Preset 1', language: 'css', data: '.btn { border-radius: 4px; }' },
      { name: 'Preset 2', language: 'js', data: 'function area(w, h) { return w * h; }' },
      { name: 'Zeta Preset 3', language: 'py', data: 'def greet(n):\n    return f"hi {n}"' },
      { name: 'Zeta Preset 4', language: 'html', data: '<div class="wrap"></div>' },
      { name: 'Zeta Preset 5', language: 'svg', data: '<svg viewBox="0 0 1 1"></svg>' },
    ];
    for (const dto of dtos) {
      const { res, json } = await api('POST', '/presets', { cookie: cookieA, body: dto });
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`create ${dto.name} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
      }
      if (!json.id || json.data !== dto.data || json.name !== dto.name) {
        throw new Error(`bad payload ${JSON.stringify(json).slice(0, 150)}`);
      }
      if (json.createdAt == null || json.updatedAt == null) throw new Error('missing timestamps');
      presetIds.push({ id: json.id, name: json.name });
    }
    return '5 presets created with timestamps';
  });

  let containerId;
  await step('verbatim storage: multi-line code survives a round trip exactly', async () => {
    const { res, json } = await api('POST', '/presets', {
      cookie: cookieA,
      body: { name: 'alignment', language: 'css', data: VERBATIM_CODE },
    });
    if (res.status !== 201 && res.status !== 200) throw new Error(`create verbatim → ${res.status}`);
    if (json.data !== VERBATIM_CODE) {
      throw new Error(`data mutated on create: ${JSON.stringify({ sent: VERBATIM_CODE, got: json.data })}`);
    }
    const back = await api('GET', `/presets/${json.id}`, { cookie: cookieA });
    if (back.json.data !== VERBATIM_CODE) {
      throw new Error(`data mutated on re-read: ${JSON.stringify(back.json.data)}`);
    }
    containerId = json.id;
    return 'tabs/newlines/%/\\/unicode preserved on write & read';
  });

  await step('create validation: missing/empty name/language/data → 400', async () => {
    for (const body of [
      {},
      { language: 'css', data: '.a{}' },
      { name: 't', data: '.a{}' },
      { name: 't', language: 'css' },
      { name: 't', language: 'css', data: '' },
      { name: '', language: 'css', data: '.a{}' },
    ]) {
      const { res } = await api('POST', '/presets', { cookie: cookieA, body });
      if (res.status !== 400) throw new Error(`bad body → expected 400, got ${res.status}`);
    }
    return 'required fields enforced';
  });

  await step('pagination: default list → total 6', async () => {
    const { res, json } = await api('GET', '/presets', { cookie: cookieA });
    if (res.status !== 200) throw new Error(`list ${res.status}`);
    if (json.total !== 6 || json.page !== 1 || json.limit !== 20) {
      throw new Error(`bad envelope ${JSON.stringify({ total: json.total, page: json.page, limit: json.limit })}`);
    }
    return 'total=6 page=1 limit=20';
  });

  await step('pagination: page 2 / limit 2 → totalPages 3', async () => {
    const { json } = await api('GET', '/presets?page=2&limit=2', { cookie: cookieA });
    if (json.total !== 6 || json.totalPages !== 3) throw new Error(`bad envelope ${JSON.stringify(json).slice(0, 150)}`);
    if (json.items.length !== 2 || json.page !== 2) throw new Error(`bad page shape ${JSON.stringify(json.items).slice(0, 100)}`);
    return 'page=2 limit=2 total=6 totalPages=3';
  });

  await step('query validation: bad params → 400', async () => {
    for (const q of ['?limit=1000', '?page=0', '?sortBy=data', '?sortOrder=up']) {
      const { res } = await api('GET', `/presets${q}`, { cookie: cookieA });
      if (res.status !== 400) throw new Error(`${q} → expected 400, got ${res.status}`);
    }
    return 'limit/page/sortBy/sortOrder validated';
  });

  await step('search by name; LIKE wildcards escaped', async () => {
    const hit = await api('GET', '/presets?search=Preset%202', { cookie: cookieA });
    if (hit.json.total !== 1) throw new Error(`name hit expected 1, got ${hit.json.total}`);
    if (hit.json.items[0].name !== 'Preset 2') throw new Error('wrong hit');
    const wild = await api('GET', '/presets?search=Preset%252', { cookie: cookieA });
    if (wild.json.total !== 0) throw new Error('unescaped wildcard matched');
    return '1 hit for "Preset 2", 0 for wildcard';
  });

  await step('language filter (exact) composes with name search', async () => {
    const css = await api('GET', '/presets?language=css', { cookie: cookieA });
    if (css.json.total !== 2) throw new Error(`language=css → ${css.json.total}, want 2`);
    const cssSearch = await api('GET', '/presets?language=css&search=alignment', { cookie: cookieA });
    if (cssSearch.json.total !== 1 || cssSearch.json.items[0].name !== 'alignment') {
      throw new Error(`filter+search broke: ${JSON.stringify(cssSearch.json).slice(0, 150)}`);
    }
    return 'css=2 rows; search=alignment within css=1';
  });

  await step('sorting: name asc (default)/desc + createdAt desc default', async () => {
    const { json: nameAsc } = await api('GET', '/presets?sortBy=name&limit=1', { cookie: cookieA });
    if (nameAsc.items[0].name !== 'Preset 2') throw new Error(`name asc first was ${nameAsc.items[0].name}`);
    const { json: nameDesc } = await api('GET', '/presets?sortBy=name&sortOrder=desc&limit=1', { cookie: cookieA });
    // DB collation is byte-wise ("C"-like): lowercase "alignment" (a=97) sorts
    // AFTER uppercase names (P=80, Z=90), so desc-first is "alignment".
    if (nameDesc.items[0].name !== 'alignment') throw new Error(`name desc first was ${nameDesc.items[0].name}`);
    const { json: defaultList } = await api('GET', '/presets', { cookie: cookieA });
    if (defaultList.items[0].name !== 'alignment') throw new Error(`default sort first was ${defaultList.items[0].name}`);
    return 'name asc/desc + createdAt desc default';
  });

  await step('createdAt explicit asc really ascends (no duplicate-key orderBy overwrite)', async () => {
    const { json: asc } = await api('GET', '/presets?sortBy=createdAt&sortOrder=asc&limit=1', { cookie: cookieA });
    if (asc.items[0].name !== 'Zeta Preset 1') {
      throw new Error(`createdAt asc first was ${asc.items[0].name}, want Zeta Preset 1 (oldest)`);
    }
    const { json: desc } = await api('GET', '/presets?sortBy=createdAt&sortOrder=desc&limit=1', { cookie: cookieA });
    if (desc.items[0].name !== 'alignment') {
      throw new Error(`createdAt desc first was ${desc.items[0].name}, want alignment (newest)`);
    }
    return 'asc → oldest first, desc → newest first';
  });

  let updatedPreset;
  await step('PATCH /presets/:id updates fields + updatedAt + verbatim data', async () => {
    const target = presetIds[1]; // 'Preset 2' (js)
    const patch = { name: 'Box area', language: 'javascript', data: 'const area = (w, h) =>\n\tw * h;\n  ' };
    await api('PATCH', `/presets/${target.id}`, { cookie: cookieA, body: patch });
    const after = await api('GET', `/presets/${target.id}`, { cookie: cookieA });
    if (after.json.name !== 'Box area' || after.json.language !== 'javascript') {
      throw new Error(`patch not applied ${JSON.stringify(after.json)}`);
    }
    if (after.json.data !== patch.data) {
      throw new Error(`data mutated on patch: ${JSON.stringify(after.json.data)}`);
    }
    if (new Date(after.json.updatedAt) < new Date(after.json.createdAt)) throw new Error('updatedAt did not advance');
    updatedPreset = after.json;
    return 'PATCH + GET roundtrip, code verbatim';
  });

  await step('PATCH body validation → 400', async () => {
    const bad = await api('PATCH', `/presets/${updatedPreset.id}`, { cookie: cookieA, body: {} });
    if (bad.res.status !== 400) throw new Error(`empty body → ${bad.res.status}, want 400`);
    const badData = await api('PATCH', `/presets/${updatedPreset.id}`, { cookie: cookieA, body: { data: '' } });
    if (badData.res.status !== 400) throw new Error(`empty data → ${badData.res.status}`);
    return 'empty patch and empty data rejected';
  });

  await step('GET /presets/:id 404 for a well-formed unknown uuid', async () => {
    const { res } = await api('GET', '/presets/9d9d8765-0000-4000-8000-000000000001', { cookie: cookieA });
    if (res.status !== 404) throw new Error(`unknown uuid → ${res.status}`);
    return '404 (not 403) for missing resource';
  });

  let cookieB;
  await step('user B isolation: B cannot read/modify A’s presets', async () => {
    cookieB = await signIn(EMAIL_B);
    const own = await api('GET', '/presets', { cookie: cookieB });
    if (own.json.total !== 0) throw new Error(`B sees ${own.json.total} of A's presets`);
    const foreign = await api('GET', `/presets/${updatedPreset.id}`, { cookie: cookieB });
    if (foreign.res.status !== 404) throw new Error(`GET foreign → ${foreign.res.status}`);
    const patchForeign = await api('PATCH', `/presets/${updatedPreset.id}`, { cookie: cookieB, body: { name: 'hacked' } });
    if (patchForeign.res.status !== 404) throw new Error(`PATCH foreign → ${patchForeign.res.status}`);
    const delForeign = await api('DELETE', `/presets/${updatedPreset.id}`, { cookie: cookieB });
    if (delForeign.res.status !== 404) throw new Error(`DELETE foreign → ${delForeign.res.status}`);
    const uuidParam = await api('GET', '/presets/not-a-uuid', { cookie: cookieA });
    if (uuidParam.res.status !== 400) throw new Error(`invalid uuid → ${uuidParam.res.status}`);
    return 'full isolation (404 on read/patch/delete)';
  });

  await step('DELETE /presets/:id removes the row', async () => {
    const { res, json } = await api('DELETE', `/presets/${updatedPreset.id}`, { cookie: cookieA });
    if (res.status !== 200 && res.status !== 201) throw new Error(`delete → ${res.status}`);
    if (json.deleted !== true) throw new Error(`bad delete payload ${JSON.stringify(json)}`);
    const gone = await api('GET', `/presets/${updatedPreset.id}`, { cookie: cookieA });
    if (gone.res.status !== 404) throw new Error(`deleted row still readable → ${gone.res.status}`);
    const { rows } = await db.query(
      `select count(*)::int as n from "preset" where "user_id" = (select id from "user" where email = $1)`,
      [EMAIL_A],
    );
    if (rows[0].n !== 5) throw new Error(`DB count after delete = ${rows[0].n}`);
    return 'delete ok; DB count 5';
  });

  await step('e2e cleanup (DB rows)', async () => {
    await db.query(`delete from "preset" where "user_id" in (select id from "user" where email like 'e2e-presets-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-presets-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-presets-%')`);
    await db.query(`delete from "user" where email like 'e2e-presets-%'`);
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
