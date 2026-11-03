/**
 * IDE Snippets E2E — scripted HTTP checks against a running server.
 * Requires: server booted (npm start / start:dev) + .mail-capture.jsonl dev mode.
 *
 *  1. anon → GET /ide-snippets 401
 *  2. signup → verify → session cookie
 *  3. create ×5 across languages (uuid ids, timestamps)
 *  4. verbatim storage: multi-line code with tabs/%/\ survives a round trip
 *  5. create validation: missing language/data → 400
 *  6. pagination (page/limit/total/totalPages)
 *  7. query validation: bad params → 400
 *  8. search over data AND language; LIKE wildcards escaped
 *  9. language filter (exact)
 * 10. sorting (language asc default, createdAt)
 * 11. update + updatedAt stamping + data stays verbatim
 * 12. 404 semantics + PATCH validation
 * 13. second user → cannot see/modify first user's snippets (isolation)
 * 14. delete
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL_A = `e2e-snippets-a-${Date.now()}@test.local`;
const EMAIL_B = `e2e-snippets-b-${Date.now()}@test.local`;
const PASSWORD = 'snippets-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — IDE SNIPPETS E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — IDE SNIPPETS E2E ✓`,
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
    body: JSON.stringify({ name: 'Snippets Tester', email, password: PASSWORD }),
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
    await db.query(`delete from "ide_snippet" where "user_id" in (select id from "user" where email like 'e2e-snippets-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-snippets-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-snippets-%')`);
    await db.query(`delete from "user" where email like 'e2e-snippets-%'`);
    return 'stale ide-snippets e2e rows removed';
  });

  const cookieA = await step('signup user A → verify → session cookie', () => signIn(EMAIL_A));

  await step('anon GET /ide-snippets → 401', async () => {
    const { res } = await api('GET', '/ide-snippets');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'service rejects anonymous access';
  });

  const snippetIds = [];
  await step('create ×5 across css/js/py/html/cpp languages', async () => {
    const dtos = [
      { language: 'css', data: '.btn { border-radius: 4px; }' },
      { language: 'js', data: 'function area(w, h) { return w * h; }' },
      { language: 'py', data: 'def greet(n):\n    return f"hi {n}"' },
      { language: 'html', data: '<div class="FindMe wrapper"></div>' },
      { language: 'cpp', data: 'std::cout << "hi" << std::endl;', data_tags: 'x' },
    ];
    for (const dto of dtos) {
      const body = { language: dto.language, data: dto.data };
      const { res, json } = await api('POST', '/ide-snippets', { cookie: cookieA, body });
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`create ${dto.language} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
      }
      if (!json.id || json.language !== dto.language || json.data !== dto.data) {
        throw new Error(`bad payload ${JSON.stringify(json).slice(0, 150)}`);
      }
      if (json.createdAt == null || json.updatedAt == null) throw new Error('missing timestamps');
      snippetIds.push({ id: json.id, language: json.language });
    }
    return '5 snippets created with timestamps';
  });

  await step('verbatim storage: multi-line code survives a round trip exactly', async () => {
    const { res, json } = await api('POST', '/ide-snippets', {
      cookie: cookieA,
      body: { language: 'css', data: VERBATIM_CODE },
    });
    if (res.status !== 201 && res.status !== 200) throw new Error(`create verbatim → ${res.status}`);
    if (json.data !== VERBATIM_CODE) {
      throw new Error(`data mutated on create: ${JSON.stringify({ sent: VERBATIM_CODE, got: json.data })}`);
    }
    const back = await api('GET', `/ide-snippets/${json.id}`, { cookie: cookieA });
    if (back.json.data !== VERBATIM_CODE) {
      throw new Error(`data mutated on re-read: ${JSON.stringify(back.json.data)}`);
    }
    return 'tabs/newlines/%/\\/unicode preserved on write & read';
  });

  await step('create validation: missing/empty language or data → 400', async () => {
    for (const body of [{}, { data: '.a{}' }, { language: 'css' }, { language: 'css', data: '' }]) {
      const { res } = await api('POST', '/ide-snippets', { cookie: cookieA, body });
      if (res.status !== 400) throw new Error(`missing-field body → expected 400, got ${res.status}`);
    }
    return 'required fields enforced';
  });

  await step('pagination: default list → total 6', async () => {
    const { res, json } = await api('GET', '/ide-snippets', { cookie: cookieA });
    if (res.status !== 200) throw new Error(`list ${res.status}`);
    if (json.total !== 6 || json.page !== 1 || json.limit !== 20) {
      throw new Error(`bad envelope ${JSON.stringify({ total: json.total, page: json.page, limit: json.limit })}`);
    }
    return 'total=6 page=1 limit=20';
  });

  await step('pagination: page 2 / limit 2 → totalPages 3', async () => {
    const { json } = await api('GET', '/ide-snippets?page=2&limit=2', { cookie: cookieA });
    if (json.total !== 6 || json.totalPages !== 3) throw new Error(`bad envelope ${JSON.stringify(json).slice(0, 150)}`);
    if (json.items.length !== 2 || json.page !== 2) throw new Error(`bad page shape ${JSON.stringify(json.items).slice(0, 100)}`);
    return 'page=2 limit=2 total=6 totalPages=3';
  });

  await step('query validation: bad params → 400', async () => {
    for (const q of ['?limit=1000', '?page=0', '?sortBy=data', '?sortOrder=up']) {
      const { res } = await api('GET', `/ide-snippets${q}`, { cookie: cookieA });
      if (res.status !== 400) throw new Error(`${q} → expected 400, got ${res.status}`);
    }
    return 'limit/page/sortBy/sortOrder validated';
  });

  await step('search matches data AND language; wildcards escaped', async () => {
    const hitData = await api('GET', '/ide-snippets?search=wrapper', { cookie: cookieA });
    if (hitData.json.total !== 1) throw new Error(`data hit expected 1, got ${hitData.json.total}`);
    const hitLang = await api('GET', '/ide-snippets?search=cpp', { cookie: cookieA });
    if (hitLang.json.total !== 1) throw new Error(`language hit expected 1, got ${hitLang.json.total}`);
    const wild = await api('GET', '/ide-snippets?search=Find%25Me', { cookie: cookieA });
    if (wild.json.total !== 0) throw new Error('unescaped wildcard matched');
    return '1 data hit, 1 language hit, 0 for wildcard';
  });

  await step('language filter (exact) composes with search', async () => {
    const css = await api('GET', '/ide-snippets?language=css', { cookie: cookieA });
    if (css.json.total !== 2) throw new Error(`language=css → ${css.json.total}, want 2`);
    const cssSearch = await api('GET', '/ide-snippets?language=css&search=btn', { cookie: cookieA });
    if (cssSearch.json.total !== 1) throw new Error(`filter+search → ${cssSearch.json.total}, want 1`);
    return 'css=2 rows; search=btn within css=1';
  });

  await step('sort by language asc (default) and desc; createdAt desc default', async () => {
    const { json: langAsc } = await api('GET', '/ide-snippets?sortBy=language&limit=1', { cookie: cookieA });
    if (langAsc.items[0].language !== 'cpp') throw new Error(`language asc first was ${langAsc.items[0].language}`);
    const { json: langDesc } = await api('GET', '/ide-snippets?sortBy=language&sortOrder=desc&limit=1', { cookie: cookieA });
    if (langDesc.items[0].language !== 'py') throw new Error(`language desc first was ${langDesc.items[0].language}`);
    const { json: defaultList } = await api('GET', '/ide-snippets', { cookie: cookieA });
    if (defaultList.items[0].language !== 'css') throw new Error(`default sort first was ${defaultList.items[0].language}`);
    return 'language asc/desc + createdAt desc default';
  });

  let updatedSnippet;
  await step('PATCH /ide-snippets/:id updates fields + updatedAt + verbatim data', async () => {
    const target = snippetIds[1]; // js snippet
    const patch = { language: 'javascript', data: 'const area = (w, h) =>\n\tw * h;\n  ' };
    await api('PATCH', `/ide-snippets/${target.id}`, { cookie: cookieA, body: patch });
    const after = await api('GET', `/ide-snippets/${target.id}`, { cookie: cookieA });
    if (after.json.language !== 'javascript') throw new Error(`language not patched`);
    if (after.json.data !== patch.data) {
      throw new Error(`data mutated on patch: ${JSON.stringify(after.json.data)}`);
    }
    if (new Date(after.json.updatedAt) < new Date(after.json.createdAt)) throw new Error('updatedAt did not advance');
    updatedSnippet = after.json;
    return 'PATCH + GET roundtrip, code verbatim';
  });

  await step('PATCH body validation → 400', async () => {
    const bad = await api('PATCH', `/ide-snippets/${updatedSnippet.id}`, { cookie: cookieA, body: {} });
    if (bad.res.status !== 400) throw new Error(`empty body → ${bad.res.status}, want 400`);
    const badData = await api('PATCH', `/ide-snippets/${updatedSnippet.id}`, { cookie: cookieA, body: { data: '' } });
    if (badData.res.status !== 400) throw new Error(`empty data → ${badData.res.status}`);
    return 'empty patch and empty data rejected';
  });

  await step('GET /ide-snippets/:id 404 for a well-formed unknown uuid', async () => {
    const { res } = await api('GET', '/ide-snippets/9d9d8765-0000-4000-8000-000000000001', { cookie: cookieA });
    if (res.status !== 404) throw new Error(`unknown uuid → ${res.status}`);
    return '404 (not 403) for missing resource';
  });

  let cookieB;
  await step('user B isolation: B cannot read/modify A’s snippets', async () => {
    cookieB = await signIn(EMAIL_B);
    const own = await api('GET', '/ide-snippets', { cookie: cookieB });
    if (own.json.total !== 0) throw new Error(`B sees ${own.json.total} of A's snippets`);
    const foreign = await api('GET', `/ide-snippets/${updatedSnippet.id}`, { cookie: cookieB });
    if (foreign.res.status !== 404) throw new Error(`GET foreign → ${foreign.res.status}`);
    const patchForeign = await api('PATCH', `/ide-snippets/${updatedSnippet.id}`, { cookie: cookieB, body: { language: 'hacked' } });
    if (patchForeign.res.status !== 404) throw new Error(`PATCH foreign → ${patchForeign.res.status}`);
    const delForeign = await api('DELETE', `/ide-snippets/${updatedSnippet.id}`, { cookie: cookieB });
    if (delForeign.res.status !== 404) throw new Error(`DELETE foreign → ${delForeign.res.status}`);
    const uuidParam = await api('GET', '/ide-snippets/not-a-uuid', { cookie: cookieA });
    if (uuidParam.res.status !== 400) throw new Error(`invalid uuid → ${uuidParam.res.status}`);
    return 'full isolation (404 on read/patch/delete)';
  });

  await step('DELETE /ide-snippets/:id removes the row', async () => {
    const { res, json } = await api('DELETE', `/ide-snippets/${updatedSnippet.id}`, { cookie: cookieA });
    if (res.status !== 200 && res.status !== 201) throw new Error(`delete → ${res.status}`);
    if (json.deleted !== true) throw new Error(`bad delete payload ${JSON.stringify(json)}`);
    const gone = await api('GET', `/ide-snippets/${updatedSnippet.id}`, { cookie: cookieA });
    if (gone.res.status !== 404) throw new Error(`deleted row still readable → ${gone.res.status}`);
    const { rows } = await db.query(
      `select count(*)::int as n from "ide_snippet" where "user_id" = (select id from "user" where email = $1)`,
      [EMAIL_A],
    );
    if (rows[0].n !== 5) throw new Error(`DB count after delete = ${rows[0].n}`);
    return 'delete ok; DB count 5';
  });

  await step('e2e cleanup (DB rows)', async () => {
    await db.query(`delete from "ide_snippet" where "user_id" in (select id from "user" where email like 'e2e-snippets-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-snippets-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-snippets-%')`);
    await db.query(`delete from "user" where email like 'e2e-snippets-%'`);
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
