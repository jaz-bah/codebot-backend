/**
 * Search E2E — scripted HTTP checks against a running server.
 * Requires: server booted (npm start / start:dev) + .mail-capture.jsonl dev mode.
 *
 * Seeds real data through the DOMAIN APIs (todos, presets, components,
 * workspace files + note content), then verifies:
 *  1. anon → GET /search 401
 *  2. missing query → 400
 *  3. unknown @scope → 400 (with the supported list)
 *  4. scoped searches: @presets / @components / @files / @todos / @notes
 *  5. language/data/code match paths (preset data, component file body)
 *  6. limit clamp per scope
 *  7. scope-only query → recent browse
 *  8. global search (no @tokens) merges types newest-first
 *  9. user B isolation: B never sees A hits
 * 10. e2e cleanup (DB rows)
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL_A = `e2e-search-a-${Date.now()}@test.local`;
const EMAIL_B = `e2e-search-b-${Date.now()}@test.local`;
const PASSWORD = 'search-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();
const TERM = 'FindMe';

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — SEARCH E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — SEARCH E2E ✓`,
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
    body: JSON.stringify({ name: 'Search Tester', email, password: PASSWORD }),
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

  await step('test-data cleanup', async () => {
    await db.query(`delete from "component_file" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "component" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "note" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "workspace_file" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "todo" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "preset" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "user" where email like 'e2e-search-%'`);
    return 'stale search e2e rows removed';
  });

  await step('anon GET /search → 401', async () => {
    const { res } = await api('GET', `/search?q=${TERM}`);
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'service rejects anonymous access';
  });

  const cookieA = await step('signup user A → verify → session cookie', () => signIn(EMAIL_A));

  await step('seed data through the domain APIs', async () => {
    const post = async (path, body) => {
      const { res, json } = await api('POST', path, { cookie: cookieA, body });
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`${path} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
      }
      return json;
    };
    await post('/todos', { title: `${TERM} task`, description: 'search e2e' });
    await post('/presets', { name: `${TERM} preset`, language: 'css', data: 'align:center' });
    await post('/presets', { name: 'ez-locate', language: 'ts', data: `/* ${TERM} in code */ export const a = 1` });
    await post('/components', {
      name: 'alpha box', preview: '/image-url',
      files: [{ language: 'css', code: `color: ${TERM}` }],
    });
    await post('/files', {
      name: `${TERM}-notes.html`, type: 'file',
      content: `<p>${TERM} agenda</p><i>hidden tag</i>`,
    });
    return '1 todo, 2 presets, 1 component, 1 workspace file + note';
  });

  await step('missing/blank query → 400', async () => {
    const missing = await api('GET', '/search', { cookie: cookieA });
    if (missing.res.status !== 400) throw new Error(`missing q → ${missing.res.status}`);
    return 'q is required';
  });

  await step('unknown @scope → 400 with the supported list', async () => {
    const { res, json } = await api('GET', `/search?q=@widgets x`, { cookie: cookieA });
    if (res.status !== 400) throw new Error(`unknown scope → ${res.status}, want 400`);
    if (!json.message.includes('@widgets')) throw new Error(`message lacks the token: ${JSON.stringify(json)}`);
    return String(json.message).slice(0, 60);
  });

  const scoped = {
    presets: { total: 2, types: 'preset' },
    components: { total: 1, types: 'component' },
    files: { total: 1, types: 'file' },
    todos: { total: 1, types: 'todo' },
    notes: { total: 1, types: 'note' },
  };
  await step('scoped searches return exactly their domain', async () => {
    for (const [scope, want] of Object.entries(scoped)) {
      const { res, json } = await api('GET', `/search?q=@${scope}${'%20'}${TERM}`, { cookie: cookieA });
      if (res.status !== 200) throw new Error(`${scope} → ${res.status}`);
      if (json.scopes.join(',') !== scope) throw new Error(`${scope}: scopes merged wrong: ${json.scopes}`);
      if (json.total !== want.total) throw new Error(`${scope}: total ${json.total}, want ${want.total}`);
      if (json.results.some((h) => h.type !== want.types)) {
        throw new Error(`${scope}: leaked hit types ${json.results.map((h) => h.type).join(',')}`);
      }
    }
    return 'presets=2, components=1, files=1, todos=1, notes=1 — all type-pure';
  });

  await step('data/code match paths: preset code + component file body', async () => {
    const byCode = await api('GET', `/search?q=%40presets%20align`, { cookie: cookieA }); // '@presets align' (data match)
    if (byCode.json.total !== 1) throw new Error(`preset data search → ${byCode.json.total}`);
    const compCode = await api('GET', `/search?q=%40components%20color`, { cookie: cookieA }); // body of the css file
    if (compCode.json.total !== 1 || compCode.json.results[0].title !== 'alpha box') {
      throw new Error(`component code search failed: ${JSON.stringify(compCode.json).slice(0, 120)}`);
    }
    return 'deeper-than-name matching works';
  });

  await step('limit clamp: @presets limit=1 → 1 hit', async () => {
    const { json } = await api('GET', `/search?q=%40presets%20${TERM}&limit=1`, { cookie: cookieA });
    if (json.results.length !== 1 || json.limit !== 1) throw new Error(`limit not applied ${JSON.stringify(json.limit)}`);
    return 'per-scope cap respected';
  });

  await step('scope-only query → recent browse without ILIKE term', async () => {
    const { res, json } = await api('GET', `/search?q=%40presets`, { cookie: cookieA });
    if (res.status !== 200) throw new Error(`recent → ${res.status}`);
    if (json.total !== 2) throw new Error(`recent total → ${json.total}`);
    if (json.scopes[0] !== 'presets') throw new Error(`scope echo wrong: ${json.scopes}`);
    return '@presets (no term) → 2 recent presets';
  });

  await step('global search merges domains newest-first', async () => {
    const { res, json } = await api('GET', `/search?q=${TERM}`, { cookie: cookieA });
    if (res.status !== 200) throw new Error(`global → ${res.status}`);
    if (json.scopes[0] !== 'all') throw new Error(`scopes echo: ${JSON.stringify(json.scopes)}`);
    const types = json.results.map((h) => h.type);
    if (json.total < 6) throw new Error(`expected ≥6 global hits, got ${json.total}`);
    for (const want of ['preset', 'component', 'todo', 'file', 'note']) {
      if (!types.includes(want)) throw new Error(`missing global hit type: ${want}`);
    }
    const times = json.results.map((h) => new Date(h.updatedAt).getTime());
    if (JSON.stringify(times) !== JSON.stringify([...times].sort((a, b) => b - a))) {
      throw new Error('results not sorted newest-first');
    }
    return `${json.total} hits incl. all 5 seeded domains, sorted`;
  });

  await step('note hit: fileId resolution + tag-stripped preview', async () => {
    const { json } = await api('GET', `/search?q=%40notes%20${TERM}`, { cookie: cookieA });
    const hit = json.results[0];
    if (hit.type !== 'note' || !hit.id) throw new Error(`note hit shape: ${JSON.stringify(hit).slice(0, 120)}`);
    const noteByFile = await api('GET', `/notes/${hit.id}`, { cookie: cookieA });
    if (noteByFile.res.status !== 200) throw new Error(`note id does not resolve via /notes/:fileId (${noteByFile.res.status})`);
    if (hit.subtitle.includes('<')) throw new Error(`HTML tags leaked into preview: ${hit.subtitle.slice(0, 80)}`);
    if (!hit.subtitle.includes(TERM)) throw new Error(`preview lost the match: ${JSON.stringify(hit.subtitle).slice(0, 80)}`);
    return 'hit.id is a resolvable fileId; preview is tag-free';
  });

  await step('LIKE wildcards are escaped', async () => {
    const { json } = await api('GET', `/search?q=%40presets%20%25`, { cookie: cookieA });
    if (json.total !== 0) throw new Error(`unescaped wildcard matched ${json.total} rows`);
    return '% stays literal';
  });

  let cookieB;
  await step('user B isolation: zero hits for A data, no info leak', async () => {
    cookieB = await signIn(EMAIL_B);
    const res = await api('GET', `/search?q=${TERM}`, { cookie: cookieB });
    if (res.json.total !== 0) throw new Error(`B saw ${res.json.total} hits of A's data`);
    if (res.json.results.length !== 0) throw new Error('B got non-empty results');
    return 'B: total=0, empty results';
  });

  await step('e2e cleanup (DB rows)', async () => {
    await db.query(`delete from "component_file" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "component" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "note" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "workspace_file" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "todo" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "preset" where "user_id" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-search-%')`);
    await db.query(`delete from "user" where email like 'e2e-search-%'`);
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
