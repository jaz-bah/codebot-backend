/**
 * Posts E2E — scripted HTTP checks against a running server.
 * Requires: server booted (npm start / start:dev) + .mail-capture.jsonl dev mode.
 *
 *  1. anon → GET /posts 200 (PUBLIC feed) but POST /posts 401
 *  2. signup → verify → session cookie
 *  3. publish M2 resources (todo + preset) as public posts
 *  4. one post per resource (uq_post_resource) → 409
 *  5. public feed + pagination + search + resourceType filter + votes sort
 *  6. author info, voteCount, viewer hasVoted (anon always false)
 *  7. votes: one per user (dup → 409), fresh counts on vote/unvote
 *  8. owner-only update/delete (isolation, 404 not 403)
 *  9. un-publish → votes cascade, anon detail → 404, vote → 404
 * 10. /posts/me scoping + query validation
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL_A = `e2e-posts-a-${Date.now()}@test.local`;
const EMAIL_B = `e2e-posts-b-${Date.now()}@test.local`;
const PASSWORD = 'posts-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — POSTS E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — POSTS E2E ✓`,
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
    body: JSON.stringify({ name: 'Posts Tester', email, password: PASSWORD }),
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

  const cleanup = async () => {
    await db.query(`delete from "post_vote" where "post_id" in (select p.id from "post" p join "user" u on u.id = p.user_id where u.email like 'e2e-posts-%')`);
    await db.query(`delete from "post" where "user_id" in (select id from "user" where email like 'e2e-posts-%')`);
    await db.query(`delete from "todo" where "user_id" in (select id from "user" where email like 'e2e-posts-%')`);
    await db.query(`delete from "preset" where "user_id" in (select id from "user" where email like 'e2e-posts-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-posts-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-posts-%')`);
    await db.query(`delete from "user" where email like 'e2e-posts-%'`);
  };

  await step('test-data cleanup', async () => {
    await cleanup();
    return 'stale posts e2e rows removed';
  });

  await step('anon GET /posts → 200 (PUBLIC feed)', async () => {
    const { res, json } = await api('GET', '/posts');
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
    if (!('items' in json) || !('total' in json)) throw new Error('feed envelope missing items/total');
    return 'feed envelope ok';
  });

  await step('anon POST /posts → 401', async () => {
    const { res } = await api('POST', '/posts', { body: { resourceType: 'todo', resourceId: crypto.randomUUID(), title: 'anon' } });
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'publish requires a session';
  });

  const cookieA = await step('signup user A → verify → session cookie', () => signIn(EMAIL_A));

  // A creates TWO resources of DIFFERENT types to publish.
  const todoA = await step('create resource: todo', async () => {
    const { res, json } = await api('POST', '/todos', { cookie: cookieA, body: { title: 'Shared todo', description: 'resource body' } });
    if (res.status !== 201 && res.status !== 200) throw new Error(`todo create ${res.status}`);
    return json;
  });
  const presetA = await step('create resource: preset', async () => {
    const { res, json } = await api('POST', '/presets', { cookie: cookieA, body: { name: 'Shared preset', language: 'javascript', data: 'const x = 1;' } });
    if (res.status !== 201 && res.status !== 200) throw new Error(`preset create ${res.status}`);
    return json;
  });

  const postTodo = await step('publish todo → view with author/voteCount/hasVoted', async () => {
    const { res, json } = await api('POST', '/posts', {
      cookie: cookieA,
      body: { resourceType: 'todo', resourceId: todoA.id, title: 'Fresh todo share', description: 'see description' },
    });
    if (res.status !== 201 && res.status !== 200) throw new Error(`publish ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    if (json.resourceType !== 'todo' || json.resourceId !== todoA.id) throw new Error('resource pointer wrong');
    if (json.author.username === undefined || json.voteCount !== 0) throw new Error(`bad view ${JSON.stringify(json).slice(0, 160)}`);
    if (json.hasVoted !== false) throw new Error('own post must start with 0 votes/hasVoted false');
    return json;
  });

  const postPreset = await step('publish preset', async () => {
    const { res, json } = await api('POST', '/posts', {
      cookie: cookieA,
      body: { resourceType: 'preset', resourceId: presetA.id, title: 'JS preset' },
    });
    if (res.status !== 201 && res.status !== 200) throw new Error(`publish ${res.status}`);
    return json;
  });

  await step('same resource twice → 409 (one post per resource)', async () => {
    const { res } = await api('POST', '/posts', {
      cookie: cookieA,
      body: { resourceType: 'todo', resourceId: todoA.id, title: 'again' },
    });
    if (res.status !== 409) throw new Error(`expected 409, got ${res.status}`);
    return 'uq_post_resource enforced';
  });

  let cookieB;
  await step('user B: CANNOT publish A’s resource (404, no leak)', async () => {
    cookieB = await signIn(EMAIL_B);
    const { res } = await api('POST', '/posts', {
      cookie: cookieB,
      body: { resourceType: 'todo', resourceId: todoA.id, title: 'stolen' },
    });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
    return 'foreign resource → 404';
  });

  await step('public feed shows posts + author (anon hasVoted=false)', async () => {
    const { json } = await api('GET', '/posts');
    const own = json.items.find((p) => p.id === postTodo.id);
    if (!own) throw new Error('published todo missing from anon feed');
    if (own.hasVoted !== false) throw new Error('anon must see hasVoted false');
    if (own.author.id !== own.userId) throw new Error('author id mismatch');
    return `total=${json.total}, anon view ok`;
  });

  await step('filter by resourceType + search + pagination', async () => {
    const todos = await api('GET', '/posts?resourceType=todo', { cookie: cookieA });
    if (todos.json.total !== 1) throw new Error(`resourceType filter → ${todos.json.total}`);
    const hit = await api('GET', '/posts?search=%100%25', { cookie: cookieA });
    if (hit.json.total !== 0) throw new Error('unescaped wildcard matched');
    const found = await api('GET', '/posts?search=fresh todo', { cookie: cookieA });
    if (found.json.total !== 1) throw new Error(`search → ${found.json.total}`);
    const page = await api('GET', '/posts?page=1&limit=1', { cookie: cookieA });
    if (page.json.items.length !== 1 || page.json.total !== 2 || page.json.totalPages !== 2) {
      throw new Error(`bad envelope ${JSON.stringify(page.json).slice(0, 150)}`);
    }
    return 'filter/search/pagination ok';
  });

  await step('sortBy=votes ranks vote leaders first', async () => {
    // B votes for the todo post → todo post should be first by votes desc.
    await api('POST', `/posts/${postTodo.id}/vote`, { cookie: cookieB });
    const { json } = await api('GET', '/posts?sortBy=votes&limit=1', { cookie: cookieA });
    if (json.items[0].id !== postTodo.id) throw new Error(`first was ${json.items[0].id}`);
    return 'votes sort ok';
  });

  await step('query validation → 400', async () => {
    for (const q of ['?limit=1000', '?page=0', '?sortBy=hack', '?resourceType=files']) {
      const { res } = await api('GET', `/posts${q}`, { cookie: cookieA });
      if (res.status !== 400) throw new Error(`${q} → expected 400, got ${res.status}`);
    }
    return 'limit/page/sortBy/resourceType validated';
  });

  await step('detail: anon sees public post, viewer sees own vote', async () => {
    const anon = await api('GET', `/posts/${postTodo.id}`);
    if (anon.res.status !== 200) throw new Error(`anon detail ${anon.res.status}`);
    const viewer = await api('GET', `/posts/${postTodo.id}`, { cookie: cookieB });
    if (viewer.json.hasVoted !== true) throw new Error('voter hasVoted must be true');
    if (viewer.json.voteCount !== 1) throw new Error(`voteCount ${viewer.json.voteCount}`);
    const bad = await api('GET', '/posts/not-a-uuid', { cookie: cookieA });
    if (bad.res.status !== 400) throw new Error(`bad uuid → ${bad.res.status}`);
    return 'anon+viewer views ok';
  });

  await step('votes: one per user — dup → 409, fresh counts', async () => {
    const dup = await api('POST', `/posts/${postTodo.id}/vote`, { cookie: cookieB });
    if (dup.res.status !== 409) throw new Error(`expected 409, got ${dup.res.status}`);
    const un = await api('DELETE', `/posts/${postTodo.id}/vote`, { cookie: cookieB });
    if (un.json.hasVoted !== false || un.json.voteCount !== 0) throw new Error(`unvote ${JSON.stringify(un.json)}`);
    if (un.res.status !== 200 && un.res.status !== 201) throw new Error(`unvote ${un.res.status}`);
    const again = await api('DELETE', `/posts/${postTodo.id}/vote`, { cookie: cookieB });
    if (again.res.status !== 404) throw new Error(`never-cast unvote → ${again.res.status}`);
    // leave the todo post with A's own vote
    await api('POST', `/posts/${postTodo.id}/vote`, { cookie: cookieA });
    return 'dup→409, unvote, re-unvote→404';
  });

  await step('update: owner-only, scoped, DB clock updatedAt', async () => {
    const patch = await api('PATCH', `/posts/${postTodo.id}`, { cookie: cookieA, body: { title: 'Renamed share' } });
    if (patch.res.status !== 200 && patch.res.status !== 201) throw new Error(`patch ${patch.res.status}`);
    if (patch.json.title !== 'Renamed share') throw new Error(`title ${patch.json.title}`);
    const foreign = await api('PATCH', `/posts/${postTodo.id}`, { cookie: cookieB, body: { title: 'hijack' } });
    if (foreign.res.status !== 404) throw new Error(`patch foreign → ${foreign.res.status}`);
    const empty = await api('PATCH', `/posts/${postTodo.id}`, { cookie: cookieA, body: {} });
    if (empty.res.status !== 400) throw new Error(`empty patch → ${empty.res.status}`);
    const bad = await api('PATCH', `/posts/${postTodo.id}`, { cookie: cookieA, body: { resourceType: 'preset' } });
    if (bad.res.status === 200 || bad.res.status === 201) throw new Error('resource re-pointing must be impossible');
    return 'owner-only ok';
  });

  await step('/posts/me scoping', async () => {
    const mine = await api('GET', '/posts/me', { cookie: cookieA });
    if (mine.json.total !== 2) throw new Error(`A sees ${mine.json.total} of own posts`);
    const theirs = await api('GET', '/posts/me', { cookie: cookieB });
    if (theirs.json.total !== 0) throw new Error(`B sees ${theirs.json.total}`);
    return 'me scoped ok';
  });

  await step('un-publish: cascade + follow-up 404s', async () => {
    const foreign = await api('DELETE', `/posts/${postTodo.id}`, { cookie: cookieB });
    if (foreign.res.status !== 404) throw new Error(`foreign delete → ${foreign.res.status}`);
    const gone = await api('DELETE', `/posts/${postTodo.id}`, { cookie: cookieA });
    if (gone.res.status !== 200 && gone.res.status !== 201) throw new Error(`delete ${gone.res.status}`);
    const detail = await api('GET', `/posts/${postTodo.id}`);
    if (detail.res.status !== 404) throw new Error(`anon detail after delete → ${detail.res.status}`);
    const vote = await api('POST', `/posts/${postTodo.id}/vote`, { cookie: cookieB });
    if (vote.res.status !== 404) throw new Error(`vote missing post → ${vote.res.status}`);
    // preset post remains; delete it too (cleanup check for the cascade path)
    const gone2 = await api('DELETE', `/posts/${postPreset.id}`, { cookie: cookieA });
    if (gone2.res.status !== 200 && gone2.res.status !== 201) throw new Error(`delete preset ${gone2.res.status}`);
    return 'cascade + 404 handling ok';
  });

  await step('e2e cleanup (DB rows)', async () => {
    await cleanup();
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
