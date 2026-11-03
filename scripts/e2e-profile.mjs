/**
 * Profile E2E — scripted HTTP checks against a running server.
 * Requires: server booted (npm start / start:dev) + .mail-capture.jsonl dev mode.
 *
 * The profile row is created lazily on first GET; counts are computed live.
 *  1. anon → GET /profile 401
 *  2. GET /profile → auto-created, auto nickname ^cb[a-z2-9]{5}$, zero counts
 *  3. nickname is STABLE across subsequent GETs
 *  4. seed data through the domain APIs → counts reflect it exactly
 *      (2 todos, 1 preset, 1 component, 1 folder, 1 file+note → 0 experts/tools/snippets/documents)
 *  5. user B: own profile, counts partitioned (B sees zero)
 *  6. PATCH /profile → claim a custom nickname
 *  7. PATCH same nickname again → idempotent 200
 *  8. PATCH a nickname B owns → 409
 *  9. PATCH invalid slugs → 400 (joi)
 * 10. POST /profile/nickname/rotate → fresh unique auto-gen nickname
 * 11. e2e cleanup (DB rows)
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL_A = `e2e-profile-a-${Date.now()}@test.local`;
const EMAIL_B = `e2e-profile-b-${Date.now()}@test.local`;
const PASSWORD = 'profile-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — PROFILE E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — PROFILE E2E ✓`,
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
    body: JSON.stringify({ name: 'Profile Tester', email, password: PASSWORD }),
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

const NICK_RE = /^cb[a-z2-9]{5}$/;

async function main() {
  const step = async (name, fn) => {
    try {
      const value = await fn();
      results.push([name, 'PASS', value ?? '']);
      console.log(`[PASS] ${name}${value ? ' — ' + (value.length ? String(value).slice(0, 44) + '...' : value) : ''}`);
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
    for (const table of ['component_file', 'component', 'note', 'workspace_file', 'todo', 'preset', 'profile']) {
      await db.query(`delete from "${table}" where "user_id" in (select id from "user" where email like 'e2e-profile-%')`);
    }
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-profile-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-profile-%')`);
    await db.query(`delete from "user" where email like 'e2e-profile-%'`);
    return 'stale profile e2e rows removed';
  });

  await step('anon GET /profile → 401', async () => {
    const { res } = await api('GET', '/profile');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'service rejects anonymous access';
  });

  const cookieA = await step('signup user A → verify → session cookie', () => signIn(EMAIL_A));

  let nicknameA;
  await step('first GET /profile auto-creates: cb-handle + all-zero counts', async () => {
    const { res, json } = await api('GET', '/profile', { cookie: cookieA });
    if (res.status !== 200) throw new Error(`GET → ${res.status}`);
    nicknameA = json.nickname;
    if (!NICK_RE.test(nicknameA)) throw new Error(`nickname not auto-gen: ${nicknameA}`);
    const want = { todos: 0, notes: 0, files: 0, folders: 0, documents: 0, components: 0, presets: 0, experts: 0, tools: 0, snippets: 0 };
    for (const [k, v] of Object.entries(want)) {
      if (json.counts[k] !== v) throw new Error(`counts.${k} = ${json.counts[k]}, want 0`);
    }
    return `nickname=${nicknameA}, 10 counts all zero`;
  });

  await step('nickname is stable across GETs (no regeneration)', async () => {
    const { json } = await api('GET', '/profile', { cookie: cookieA });
    if (json.nickname !== nicknameA) throw new Error(`${json.nickname} != ${nicknameA}`);
    return 'same handle back';
  });

  await step('seed data through the domain APIs', async () => {
    const post = async (path, body) => {
      const { res, json } = await api('POST', path, { cookie: cookieA, body });
      if (res.status !== 201 && res.status !== 200) {
        throw new Error(`${path} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
      }
      return json;
    };
    await post('/todos', { title: 'profile e2e todo 1', description: 'counts check' });
    await post('/todos', { title: 'profile e2e todo 2', description: 'counts check' });
    await post('/presets', { name: 'count-me', language: 'css', data: 'align:center' });
    await post('/components', {
      name: 'counted component', preview: '/image-url',
      files: [{ language: 'css', code: 'align: center' }],
    });
    await post('/files', { name: 'docs', type: 'folder' });
    await post('/files', { name: 'counted.html', type: 'file', content: '<p>profile counts note</p>' });
    return '2 todos, 1 preset, 1 component, 1 folder, 1 file+note';
  });

  await step('counts reflect the seeds EXACTLY (live, never stale)', async () => {
    const { json } = await api('GET', '/profile', { cookie: cookieA });
    const want = { todos: 2, notes: 1, files: 1, folders: 1, documents: 0, components: 1, presets: 1, experts: 0, tools: 0, snippets: 0 };
    for (const [k, v] of Object.entries(want)) {
      if (json.counts[k] !== v) throw new Error(`counts.${k} = ${json.counts[k]}, want ${v}`);
    }
    return 'todos=2 notes=1 files=1 folders=1 components=1 presets=1 rest=0';
  });

  let nicknameB;
  const cookieB = await step('signup user B → own profile with unique handle', async () => {
    const cookie = await signIn(EMAIL_B);
    const { json } = await api('GET', '/profile', { cookie });
    if (!NICK_RE.test(json.nickname)) throw new Error(`B nickname not auto-gen: ${json.nickname}`);
    if (json.nickname === nicknameA) throw new Error('A and B share a nickname!');
    for (const v of Object.values(json.counts)) {
      if (v !== 0) throw new Error(`B sees non-zero counts: ${JSON.stringify(json.counts)}`);
    }
    nicknameB = json.nickname;
    return `B=${json.nickname}, counts partitioned from A`;
  });

  await step('PATCH /profile claims a custom nickname', async () => {
    const { res, json } = await api('PATCH', '/profile', { cookie: cookieA, body: { nickname: 'e2e_tester' } });
    if (res.status !== 200) throw new Error(`PATCH → ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
    if (json.nickname !== 'e2e_tester') throw new Error(`nickname not claimed: ${json.nickname}`);
    const again = await api('GET', '/profile', { cookie: cookieA });
    if (again.json.nickname !== 'e2e_tester') throw new Error('claim did not persist');
    return 'nickname=e2e_tester, persists on re-read';
  });

  await step('re-claiming your own nickname is idempotent (200)', async () => {
    const { res, json } = await api('PATCH', '/profile', { cookie: cookieA, body: { nickname: 'e2e_tester' } });
    if (res.status !== 200) throw new Error(`idempotent PATCH → ${res.status}`);
    if (json.nickname !== 'e2e_tester') throw new Error(`changed: ${json.nickname}`);
    return 'no 409 loop on same-value claim';
  });

  await step('PATCH a nickname owned by B → 409 conflict', async () => {
    const { res, json } = await api('PATCH', '/profile', { cookie: cookieA, body: { nickname: nicknameB } });
    if (res.status !== 409) throw new Error(`expected 409, got ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
    return `"${nicknameB}" is protected`;
  });

  await step('PATCH invalid slugs → 400 (joi)', async () => {
    for (const nickname of ['no', 'x'.repeat(25), 'has space', 'has.dot', 'has@at']) {
      const { res } = await api('PATCH', '/profile', { cookie: cookieA, body: { nickname } });
      if (res.status !== 400) throw new Error(`'${nickname}' → ${res.status}, want 400`);
    }
    return 'length/charset/blank rules enforced';
  });

  await step('uppercase input is lowercased, not rejected', async () => {
    const { res, json } = await api('PATCH', '/profile', { cookie: cookieA, body: { nickname: 'AngryWombat' } });
    if (res.status !== 200) throw new Error(`lowercase PATCH → ${res.status}`);
    if (json.nickname !== 'angrywombat') throw new Error(`not lowercased: ${json.nickname}`);
    return 'AngryWombat → angrywombat';
  });

  await step('rotate → fresh unique auto-gen nickname', async () => {
    const { res, json } = await api('POST', '/profile/nickname/rotate', { cookie: cookieA });
    // NestJS POST default is 201 Created — same as POST /todos (house style).
    if (res.status !== 201) throw new Error(`rotate → ${res.status}`);
    if (!NICK_RE.test(json.nickname)) throw new Error(`rotated handle not auto-gen: ${json.nickname}`);
    if (['e2e_tester', 'angrywombat', nicknameA].includes(json.nickname)) {
      throw new Error(`rotate returned a stale handle: ${json.nickname}`);
    }
    return `${json.nickname} (was angrywombat)`;
  });

  await step('e2e cleanup (DB rows)', async () => {
    for (const table of ['component_file', 'component', 'note', 'workspace_file', 'todo', 'preset', 'profile']) {
      await db.query(`delete from "${table}" where "user_id" in (select id from "user" where email like 'e2e-profile-%')`);
    }
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-profile-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-profile-%')`);
    await db.query(`delete from "user" where email like 'e2e-profile-%'`);
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
