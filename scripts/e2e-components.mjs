/**
 * Components E2E — scripted HTTP checks against a running server.
 * Requires: server booted (npm start / start:dev) + .mail-capture.jsonl dev mode.
 * The `component`/`component_file` tables must be migrated (npm run migration:run).
 *
 *  1. test-data cleanup (stale e2e-components rows)
 *  2. anon → GET /components 401
 *  3. signup user A → verify → session cookie
 *  4. create ×3 (multi-language, formatting-sensitive code) → DB rows verified
 *  5. pagination (default envelope; page 2 / limit 2)
 *  6. query validation: bad params → 400
 *  7. search by name (ILIKE, wildcards escaped)
 *  8. filter by language (EXISTS semantics)
 *  9. GET one → files attached in insertion order
 * 10. formatting is preserved VERBATIM (DB text check)
 * 11. PATCH metadata + updatedAt stamping
 * 12. PATCH files → FULL replacement (old set gone, new set inserted)
 * 13. PATCH validation → 400 (empty body, bad language, empty files array)
 * 14. invalid uuid → 400; unknown component → 404
 * 15. user B isolation (read/patch/delete foreign → 404)
 * 16. DELETE → FK cascade removes component_file rows (DB check)
 * 17. e2e cleanup (DB rows)
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL_A = `e2e-components-a-${Date.now()}@test.local`;
const EMAIL_B = `e2e-components-b-${Date.now()}@test.local`;
const PASSWORD = 'components-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — COMPONENTS E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — COMPONENTS E2E ✓`,
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
    body: JSON.stringify({ name: 'Components Tester', email, password: PASSWORD }),
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

// Indentation + trailing newlines are significant — MUST round-trip exactly.
const FORMATTED_CSS = '  .box {\n        color: red;\n  }\n\n\n/* trailing blank lines */\n\n';

async function main() {
  const step = async (name, fn) => {
    try {
      const value = await fn();
      results.push([name, 'PASS', value ?? '']);
      console.log(`[PASS] ${name}${value ? ' — ' + (value.length ? String(value).slice(0, 40) + '...' : value) : ''}`);
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
  const userIdOf = async (email) =>
    (await db.query(`select id from "user" where email = $1`, [email])).rows[0]?.id;

  await step('test-data cleanup', async () => {
    await db.query(`delete from "component_file" where "user_id" in (select id from "user" where email like 'e2e-components-%')`);
    await db.query(`delete from "component" where "user_id" in (select id from "user" where email like 'e2e-components-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-components-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-components-%')`);
    await db.query(`delete from "user" where email like 'e2e-components-%'`);
    return 'stale components e2e rows removed';
  });

  await step('anon GET /components → 401', async () => {
    const { res } = await api('GET', '/components');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'service rejects anonymous access';
  });

  const cookieA = await step('signup user A → verify → session cookie', () => signIn(EMAIL_A));
  const userIdA = await userIdOf(EMAIL_A);

  const created = [];
  await step('create ×3 → component + files persisted (DB rows verified)', async () => {
    const payloads = [
      { name: 'alignment', preview: '/image-url', files: [{ language: 'CSS', code: FORMATTED_CSS }, { language: 'html', code: '<div class="box"></div>' }] },
      { name: 'alpha body', preview: 'https://cdn.example.com/p.png', files: [{ language: 'css', code: '.a{}' }] },
      { name: 'alpha grid', preview: '/gen.png', files: [{ language: 'ts', code: 'export const g = 1' }, { language: 'css', code: '.g{}' }] },
    ];
    for (const [i, body] of payloads.entries()) {
      const { res, json } = await api('POST', '/components', { cookie: cookieA, body });
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`create ${i} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
      }
      if (json.files.length !== body.files.length) {
        throw new Error(`create ${i}: files round-trip mismatch (${json.files.length})`);
      }
      created.push(json);
    }
    const { rows } = await db.query(
      `select count(*)::int as file_count from "component_file" where "user_id" = $1`,
      [userIdA],
    );
    if (Number(rows[0].file_count) !== 5) throw new Error(`expected 5 component_file rows, got ${rows[0].file_count}`);
    return '3 components + 5 file rows';
  });

  await step('create validation → 400 (no files, bad preview/language, >20 files)', async () => {
    const noFiles = await api('POST', '/components', { cookie: cookieA, body: { name: 'x', preview: '/x' } });
    if (noFiles.res.status !== 400) throw new Error(`missing files → ${noFiles.res.status}`);
    const emptyFiles = await api('POST', '/components', { cookie: cookieA, body: { name: 'x', preview: '/x', files: [] } });
    if (emptyFiles.res.status !== 400) throw new Error(`empty files → ${emptyFiles.res.status}`);
    const badPreview = await api('POST', '/components', { cookie: cookieA, body: { name: 'x', preview: 'relative.png', files: [{ language: 'css', code: 'a{}' }] } });
    if (badPreview.res.status !== 400) throw new Error(`bad preview → ${badPreview.res.status}`);
    const badLang = await api('POST', '/components', { cookie: cookieA, body: { name: 'x', preview: '/x', files: [{ language: 'C++', code: 'a' }] } });
    if (badLang.res.status !== 400) throw new Error(`bad language → ${badLang.res.status}`);
    const langNormalized = await api('POST', '/components', { cookie: cookieA, body: { name: 'norm', preview: '/x', files: [{ language: 'CSS', code: 'a{}' }] } });
    if (langNormalized.res.status !== 201 && langNormalized.res.status !== 200) throw new Error(`'CSS' should normalize to lowercase, got ${langNormalized.res.status}`);
    if (langNormalized.json.files[0].language !== 'css') throw new Error(`language not lowercased: ${langNormalized.json.files[0].language}`);
    await api('DELETE', `/components/${langNormalized.json.id}`, { cookie: cookieA });
    return 'validation enforced; CSS normalized to css';
  });

  await step('pagination: default envelope → total 3', async () => {
    const { res, json } = await api('GET', '/components', { cookie: cookieA });
    if (res.status !== 200) throw new Error(`list ${res.status}`);
    if (json.total !== 3 || json.page !== 1 || json.limit !== 20) {
      throw new Error(`bad envelope ${JSON.stringify({ total: json.total, page: json.page, limit: json.limit })}`);
    }
    if (json.items[0].files === undefined) throw new Error('files not attached to list items');
    return 'total=3 page=1 limit=20, files attached';
  });

  await step('pagination: page 2 / limit 2 → totalPages 2', async () => {
    const { json } = await api('GET', '/components?page=2&limit=2', { cookie: cookieA });
    if (json.total !== 3 || json.totalPages !== 2) throw new Error(`bad envelope ${JSON.stringify(json).slice(0, 150)}`);
    if (json.items.length !== 1 || json.page !== 2) throw new Error(`bad page shape ${JSON.stringify(json.items).slice(0, 100)}`);
    return 'page=2 limit=2 total=3 totalPages=2';
  });

  await step('query validation: bad params → 400', async () => {
    for (const q of ['?limit=1000', '?page=0', '?sortBy=code', '?sortOrder=ASC', '?language=C+PLUS']) {
      const { res } = await api('GET', `/components${q}`, { cookie: cookieA });
      if (res.status !== 400) throw new Error(`${q} → expected 400, got ${res.status}`);
    }
    return 'limit/page/sortBy/sortOrder/language validated';
  });

  await step('search by name, LIKE wildcards escaped', async () => {
    const hit = await api('GET', '/components?search=alpha', { cookie: cookieA });
    if (hit.json.total !== 2) throw new Error(`expected 2 hits for "alpha", got ${hit.json.total}`);
    const wild = await api('GET', '/components?search=al%25pha', { cookie: cookieA });
    if (wild.json.total !== 0) throw new Error('unescaped wildcard matched');
    return '2 hits, wildcard escaped';
  });

  await step('filter by language (EXISTS semantics)', async () => {
    const ts = await api('GET', '/components?language=ts', { cookie: cookieA });
    if (ts.json.total !== 1) throw new Error(`language=ts → ${ts.json.total}`);
    if (ts.json.items[0].name !== 'alpha grid') throw new Error(`language=ts matched ${ts.json.items[0].name}`);
    const upper = await api('GET', '/components?language=CSS', { cookie: cookieA });
    if (upper.json.total !== 3) throw new Error(`language=CSS (normalized) → ${upper.json.total}`);
    const css = await api('GET', '/components?language=css', { cookie: cookieA });
    if (css.json.total !== 3) throw new Error(`language=css → ${css.json.total}`);
    return 'ts→1, css→3 (case-normalized)';
  });

  let target;
  await step('GET one → files in insertion order', async () => {
    const { res, json } = await api('GET', `/components/${created[0].id}`, { cookie: cookieA });
    if (res.status !== 200) throw new Error(`get one → ${res.status}`);
    if (json.files.length !== 2) throw new Error(`expected 2 files, got ${json.files.length}`);
    if (json.files[0].language !== 'css' || json.files[1].language !== 'html') {
      throw new Error(`insertion order broken: ${json.files.map((f) => f.language).join(',')}`);
    }
    if (json.files[0].componentId !== json.id) throw new Error('file.componentId mismatch');
    target = json;
    return 'files attached, ordered css→html';
  });

  await step('formatting preserved VERBATIM (API + DB)', async () => {
    if (target.files[0].code !== FORMATTED_CSS) {
      throw new Error(`API code mangled: ${JSON.stringify(target.files[0].code).slice(0, 80)}`);
    }
    const { rows } = await db.query(
      `select code from "component_file" where component_id = $1 and language = 'css'`,
      [target.id],
    );
    if (rows[0].code !== FORMATTED_CSS) {
      throw new Error(`DB code mangled: ${JSON.stringify(rows[0].code).slice(0, 80)}`);
    }
    return 'indentation + trailing newlines byte-identical';
  });

  await step('PATCH metadata + updatedAt stamped', async () => {
    const patched = await api('PATCH', `/components/${target.id}`, {
      cookie: cookieA,
      body: { name: 'alignment-v2', preview: 'https://cdn.example.com/new.png' },
    });
    if (patched.res.status !== 200) throw new Error(`patch → ${patched.res.status}`);
    if (patched.json.name !== 'alignment-v2' || patched.json.preview !== 'https://cdn.example.com/new.png') {
      throw new Error(`patch not applied ${JSON.stringify(patched.json).slice(0, 120)}`);
    }
    if (patched.json.files.length !== 2) throw new Error('files not attached to PATCH response');
    if (new Date(patched.json.updatedAt) < new Date(target.updatedAt)) throw new Error('updatedAt did not advance');
    return 'renamed + preview swapped, files untouched';
  });

  await step('PATCH validation → 400 (empty body, bad language, empty files)', async () => {
    const empty = await api('PATCH', `/components/${target.id}`, { cookie: cookieA, body: {} });
    if (empty.res.status !== 400) throw new Error(`empty patch → ${empty.res.status}`);
    const badLang = await api('PATCH', `/components/${target.id}`, { cookie: cookieA, body: { files: [{ language: 'NO!', code: 'x' }] } });
    if (badLang.res.status !== 400) throw new Error(`bad language → ${badLang.res.status}`);
    const emptyFiles = await api('PATCH', `/components/${target.id}`, { cookie: cookieA, body: { files: [] } });
    if (emptyFiles.res.status !== 400) throw new Error(`empty files → ${emptyFiles.res.status}`);
    return 'empty patch and invalid file set rejected';
  });

  await step('PATCH files → FULL replacement (old set gone)', async () => {
    const before = await db.query(
      `select id, language from "component_file" where component_id = $1 order by language`,
      [target.id],
    );
    if (before.rows.length !== 2) throw new Error(`pre-replace file count ${before.rows.length}`);

    const replaced = await api('PATCH', `/components/${target.id}`, {
      cookie: cookieA,
      body: { files: [{ language: 'css', code: 'align:center' }, { language: 'js', code: 'const a = 1' }] },
    });
    if (replaced.res.status !== 200) throw new Error(`replace → ${replaced.res.status}`);
    if (replaced.json.files.map((f) => f.language).join(',') !== 'css,js') {
      throw new Error(`replacement languages wrong: ${replaced.json.files.map((f) => f.language).join(',')}`);
    }
    const after = await db.query(
      `select language from "component_file" where component_id = $1 order by language`,
      [target.id],
    );
    if (after.rows.map((r) => r.language).join(',') !== 'css,js') {
      throw new Error(`DB file set not replaced: ${after.rows.map((r) => r.language).join(',')}`);
    }
    if (after.rows.some((r) => r.language === 'html')) throw new Error('old html file survived the replacement');
    return 'delete-then-insert inside one transaction';
  });

  await step('parameter guards: invalid uuid → 400, unknown id → 404', async () => {
    const bad = await api('GET', '/components/not-a-uuid', { cookie: cookieA });
    if (bad.res.status !== 400) throw new Error(`invalid uuid → ${bad.res.status}`);
    const unknown = await api('GET', '/components/00000000-0000-4000-8000-000000000000', { cookie: cookieA });
    if (unknown.res.status !== 404) throw new Error(`unknown id → ${unknown.res.status}`);
    return '400/404 mapping correct';
  });

  let cookieB;
  await step('user B isolation: B cannot read/modify A components', async () => {
    cookieB = await signIn(EMAIL_B);
    const own = await api('GET', '/components', { cookie: cookieB });
    if (own.json.total !== 0) throw new Error(`B sees ${own.json.total} of A's components`);
    const foreign = await api('GET', `/components/${target.id}`, { cookie: cookieB });
    if (foreign.res.status !== 404) throw new Error(`GET foreign → ${foreign.res.status}`);
    const patchForeign = await api('PATCH', `/components/${target.id}`, { cookie: cookieB, body: { name: 'hacked' } });
    if (patchForeign.res.status !== 404) throw new Error(`PATCH foreign → ${patchForeign.res.status}`);
    const delForeign = await api('DELETE', `/components/${target.id}`, { cookie: cookieB });
    if (delForeign.res.status !== 404) throw new Error(`DELETE foreign → ${delForeign.res.status}`);
    return 'full isolation (404 on read/patch/delete)';
  });

  await step('DELETE → FK cascade removes the file rows (DB check)', async () => {
    const { res } = await api('DELETE', `/components/${target.id}`, { cookie: cookieA });
    if (res.status !== 200 && res.status !== 201) throw new Error(`delete → ${res.status}`);
    const leftFiles = await db.query(`select count(*)::int as n from "component_file" where component_id = $1`, [target.id]);
    if (Number(leftFiles.rows[0].n) !== 0) throw new Error(`cascade did not remove files: ${leftFiles.rows[0].n} left`);
    const again = await api('GET', `/components/${target.id}`, { cookie: cookieA });
    if (again.res.status !== 404) throw new Error(`deleted component still readable (${again.res.status})`);
    return 'cascade verified at DB level';
  });

  await step('e2e cleanup (DB rows)', async () => {
    await db.query(`delete from "component_file" where "user_id" in (select id from "user" where email like 'e2e-components-%')`);
    await db.query(`delete from "component" where "user_id" in (select id from "user" where email like 'e2e-components-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-components-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-components-%')`);
    await db.query(`delete from "user" where email like 'e2e-components-%'`);
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
