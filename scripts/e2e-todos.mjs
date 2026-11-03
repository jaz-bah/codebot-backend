/**
 * Todos E2E — scripted HTTP checks against a running server.
 * Requires: server booted (npm start / start:dev) + .mail-capture.jsonl dev mode.
 *
 *  1. anon → GET /todos 401
 *  2. signup → verify → session cookie
 *  3. create ×5 → positions 0..4 (transactional append)
 *  4. pagination (page/limit/total/totalPages)
 *  5. search (protected ILIKE wildcards) + status/priority filters
 *  6. sorting (priority rank, due date, createdAt)
 *  7. update + updatedAt stamping
 *  8. reorder (subset) → validator errors + gap-free positions
 *  9. delete → compaction
 * 10. second user → cannot see/modify first user's todos (isolation)
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL_A = `e2e-todos-a-${Date.now()}@test.local`;
const EMAIL_B = `e2e-todos-b-${Date.now()}@test.local`;
const PASSWORD = 'todos-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — TODOS E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — TODOS E2E ✓`,
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
    body: JSON.stringify({ name: 'Todos Tester', email, password: PASSWORD }),
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
    await db.query(`delete from "todo" where "user_id" in (select id from "user" where email like 'e2e-todos-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-todos-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-todos-%')`);
    await db.query(`delete from "user" where email like 'e2e-todos-%'`);
    return 'stale todos e2e rows removed';
  });

  const cookieA = await step('signup user A → verify → session cookie', () => signIn(EMAIL_A));

  await step('anon GET /todos → 401', async () => {
    const { res } = await api('GET', '/todos');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'service rejects anonymous access';
  });

  const todoIds = [];
  await step('create ×5 → positions 0..4 (transactional append)', async () => {
    const pre = await api('GET', '/todos', { cookie: cookieA });
    if (pre.res.status !== 200) {
      throw new Error(`pre-session GET → ${pre.res.status}`);
    }
    for (const i of [1, 2, 3, 4, 5]) {
      const { res, json } = await api('POST', '/todos', {
        cookie: cookieA,
        body: {
          title: `Todo ${i}`,
          description: i === 3 ? 'FindMe alpha body' : null,
          priority: i === 1 ? 'low' : i === 5 ? 'urgent' : 'medium',
          status: i === 4 ? 'in_progress' : undefined,
          dueDate: i <= 2 ? undefined : `2026-0${i}-01T00:00:00.000Z`,
        },
      });
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`create ${i} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
      }
      todoIds.push({ id: json.id, i, priority: json.priority, dueDate: json.dueDate });
    }
    const { rows } = await db.query(
      `select position from "todo" where "user_id" = (select id from "user" where email = $1) order by id`,
      [EMAIL_A],
    );
    const positions = rows.map((r) => Number(r.position)).sort((a, b) => a - b);
    if (JSON.stringify(positions) !== JSON.stringify([0, 1, 2, 3, 4])) {
      throw new Error(`positions not 0..4: ${positions}`);
    }
    return '5 todos, gap-free positions';
  });

  await step('pagination: default list → total 5', async () => {
    const { res, json } = await api('GET', '/todos', { cookie: cookieA });
    if (res.status !== 200) throw new Error(`list ${res.status}`);
    if (json.total !== 5 || json.page !== 1 || json.limit !== 20) {
      throw new Error(`bad envelope ${JSON.stringify({ total: json.total, page: json.page, limit: json.limit })}`);
    }
    return 'total=5 page=1 limit=20';
  });

  await step('pagination: page 2 / limit 2 → totalPages 3', async () => {
    const { json } = await api('GET', '/todos?page=2&limit=2', { cookie: cookieA });
    if (json.total !== 5 || json.totalPages !== 3) throw new Error(`bad envelope ${JSON.stringify(json).slice(0, 150)}`);
    if (json.items.length !== 2 || json.page !== 2) throw new Error(`bad page shape ${JSON.stringify(json.items).slice(0, 100)}`);
    return 'page=2 limit=2 total=5 totalPages=3';
  });

  await step('query validation: bad params → 400', async () => {
    for (const q of ['?limit=1000', '?page=0', '?sortBy=hack', '?status=deleted']) {
      const { res } = await api('GET', `/todos${q}`, { cookie: cookieA });
      if (res.status !== 400) throw new Error(`${q} → expected 400, got ${res.status}`);
    }
    return 'limit/page/sortBy/status validated';
  });

  await step('search matches substring; LIKE wildcards are escaped', async () => {
    const hit = await api('GET', '/todos?search=findme', { cookie: cookieA });
    if (hit.json.total !== 1) throw new Error(`expected 1 hit, got ${hit.json.total}`);
    const wild = await api('GET', '/todos?search=Find%25Me', { cookie: cookieA });
    if (wild.json.total !== 0) throw new Error('unescaped wildcard matched');
    return '1 hit for "findme", 0 for wildcard';
  });

  await step('filter status + priority', async () => {
    const inprog = await api('GET', '/todos?status=in_progress', { cookie: cookieA });
    if (inprog.json.total !== 1) throw new Error(`status filter → ${inprog.json.total}`);
    const urgent = await api('GET', '/todos?priority=urgent', { cookie: cookieA });
    if (urgent.json.total !== 1) throw new Error(`priority filter → ${urgent.json.total}`);
    return 'status and priority filters work';
  });

  await step('sort by priority rank (urgency, not alphabetical)', async () => {
    const { json } = await api('GET', '/todos?sortBy=priority&sortOrder=asc&limit=1', { cookie: cookieA });
    if (json.items[0].priority !== 'low') throw new Error(`first was ${json.items[0].priority}`);
    const { json: desc } = await api('GET', '/todos?sortBy=priority&sortOrder=desc&limit=1', { cookie: cookieA });
    if (desc.items[0].priority !== 'urgent') throw new Error(`first was ${desc.items[0].priority}`);
    return 'asc→low first, desc→urgent first';
  });

  await step('sort by dueDate asc', async () => {
    const { json } = await api('GET', '/todos?sortBy=dueDate&sortOrder=asc&limit=1', { cookie: cookieA });
    if (json.items[0].dueDate === null) throw new Error('null dueDate first in asc');
    if (new Date(json.items[0].dueDate).getUTCMonth() !== 2) {
      throw new Error(`expected March (dueDate 3), got ${json.items[0].dueDate}`);
    }
    return 'earliest due date first';
  });

  let updatedTodo;
  await step('PATCH /todos/:id updates fields + updatedAt', async () => {
    const { res, json } = await api('GET', '/todos?limit=1', { cookie: cookieA }); // newest = Todo 5
    if (res.status !== 200) throw new Error('list failed');
    const target = json.items[0];
    await api('PATCH', `/todos/${target.id}`, { cookie: cookieA, body: { title: 'Todo 5 renamed', priority: 'high', status: 'done' } });
    const after = await api('GET', `/todos/${target.id}`, { cookie: cookieA });
    if (after.json.title !== 'Todo 5 renamed' || after.json.priority !== 'high' || after.json.status !== 'done') {
      throw new Error(`patch not applied ${JSON.stringify(after.json)}`);
    }
    if (new Date(after.json.updatedAt) < new Date(target.updatedAt)) throw new Error('updatedAt did not advance');
    updatedTodo = after.json;
    return 'PATCH + GET single roundtrip ok';
  });

  await step('PATCH body validation → 400', async () => {
    const bad = await api('PATCH', `/todos/${updatedTodo.id}`, { cookie: cookieA, body: {} });
    if (bad.res.status !== 400) throw new Error(`empty body → ${bad.res.status}, want 400`);
    const badStatus = await api('PATCH', `/todos/${updatedTodo.id}`, { cookie: cookieA, body: { status: 'archived' } });
    if (badStatus.res.status !== 400) throw new Error(`bad status → ${badStatus.res.status}`);
    return 'empty patch and invalid enum rejected';
  });

  await step('reorder subset (verified via DB positions)', async () => {
    // Move Todo 5 (currently pos 4) to the top.
    const { json } = await api('PATCH', '/todos/reorder', {
      cookie: cookieA,
      body: { items: [{ id: updatedTodo.id, position: 0 }] },
    });
    // Moving the LAST todo to position 0 shifts all 5 rows (4→0 plus 0..3→1..4)
    if (json.reordered !== 5) throw new Error(`expected 5 writes, got ${JSON.stringify(json)}`);
    const { rows } = await db.query(
      `select id, position from "todo" where "user_id" = (select id from "user" where email = $1) order by id`,
      [EMAIL_A],
    );
    const positions = rows.map((r) => Number(r.position)).sort((a, b) => a - b);
    if (JSON.stringify(positions) !== JSON.stringify([0, 1, 2, 3, 4])) {
      throw new Error(`positions broken after reorder: ${positions}`);
    }
    const moved = rows.find((r) => r.id === updatedTodo.id);
    if (Number(moved.position) !== 0) throw new Error(`moved todo at position ${moved.position}`);
    return `final ordering applied, ${json.reordered} rows written`;
  });

  await step('reorder validation: duplicate positions → 400, stranger id → 404', async () => {
    const dup = await api('PATCH', '/todos/reorder', {
      cookie: cookieA,
      body: { items: [{ id: updatedTodo.id, position: 0 }, { id: updatedTodo.id, position: 1 }] },
    });
    if (dup.res.status !== 400) throw new Error(`duplicate id/positions → ${dup.res.status}`);
    const dupPos = await api('PATCH', '/todos/reorder', {
      cookie: cookieA,
      // a well-formed uuid that belongs to no one
      body: { items: [{ id: '9d9d8765-0000-4000-8000-000000000001', position: 0 }] },
    });
    if (dupPos.res.status !== 404) throw new Error(`stranger id → ${dupPos.res.status}`);
    return '400 on duplicate positions, 404 on stranger id';
  });

  await step('order by manual position asc', async () => {
    const { json } = await api('GET', '/todos?sortBy=position&sortOrder=asc&limit=5', { cookie: cookieA });
    const positions = json.items.map((t) => t.position);
    if (JSON.stringify(positions) !== JSON.stringify([0, 1, 2, 3, 4])) {
      throw new Error(`positions not sorted: ${positions}`);
    }
    if (json.items[0].id !== updatedTodo.id) throw new Error('manually moved todo is not first');
    return 'manual sorting honors reorder';
  });

  let cookieB;
  await step('user B isolation: B cannot read/modify A’s todos', async () => {
    cookieB = await signIn(EMAIL_B);
    const own = await api('GET', '/todos', { cookie: cookieB });
    if (own.json.total !== 0) throw new Error(`B sees ${own.json.total} of A's todos`);
    const foreign = await api('GET', `/todos/${updatedTodo.id}`, { cookie: cookieB });
    if (foreign.res.status !== 404) throw new Error(`GET foreign → ${foreign.res.status}`);
    const patchForeign = await api('PATCH', `/todos/${updatedTodo.id}`, { cookie: cookieB, body: { title: 'hacked' } });
    if (patchForeign.res.status !== 404) throw new Error(`PATCH foreign → ${patchForeign.res.status}`);
    const delForeign = await api('DELETE', `/todos/${updatedTodo.id}`, { cookie: cookieB });
    if (delForeign.res.status !== 404) throw new Error(`DELETE foreign → ${delForeign.res.status}`);
    const reorderForeign = await api('PATCH', '/todos/reorder', { cookie: cookieB, body: { items: [{ id: updatedTodo.id, position: 0 }] } });
    if (reorderForeign.res.status !== 404) throw new Error(`reorder foreign → ${reorderForeign.res.status}`);
    const uuidParam = await api('GET', '/todos/not-a-uuid', { cookie: cookieA });
    if (uuidParam.res.status !== 400) throw new Error(`invalid uuid → ${uuidParam.res.status}`);
    return 'full isolation (404 on read/patch/delete/reorder)';
  });

  await step('DELETE compacts positions (gap-free after delete)', async () => {
    const { res } = await api('DELETE', `/todos/${updatedTodo.id}`, { cookie: cookieA });
    if (res.status !== 200 && res.status !== 201) throw new Error(`delete → ${res.status}`);
    // now 4 todos: positions must be exactly 0..3
    const { rows } = await db.query(
      `select position from "todo" where "user_id" = (select id from "user" where email = $1) order by position`,
      [EMAIL_A],
    );
    const positions = rows.map((r) => Number(r.position));
    if (JSON.stringify(positions) !== JSON.stringify([0, 1, 2, 3])) {
      throw new Error(`positions not compacted: ${positions}`);
    }
    return 'delete ok; positions compacted to 0..3';
  });

  await step('e2e cleanup (DB rows)', async () => {
    await db.query(`delete from "todo" where "user_id" in (select id from "user" where email like 'e2e-todos-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-todos-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-todos-%')`);
    await db.query(`delete from "user" where email like 'e2e-todos-%'`);
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
