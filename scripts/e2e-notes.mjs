/**
 * Notes/workspace E2E — scripted HTTP checks against a running server.
 * Requires: server booted (npm start / start:dev) + .mail-capture.jsonl dev mode.
 *
 *  1. anon → GET /files 401
 *  2. signup → verify → session cookie
 *  3. create folders/files → positions + .html validation
 *  4. tree structure (nested, ordered)
 *  5. folder contents list (pagination/filter/search)
 *  6. note content roundtrip + PATCH
 *  7. notes list (search/folder filter/pagination)
 *  8. rename/move files + folders (cycle checks)
 *  9. delete (cascade + compaction)
 * 10. second user → full isolation
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const EMAIL_A = `e2e-notes-a-${Date.now()}@test.local`;
const EMAIL_B = `e2e-notes-b-${Date.now()}@test.local`;
const PASSWORD = 'notes-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const MEETING_HTML = `
<h2>Team sync — agenda</h2>
<ul><li>Ship the <code>onboarding</code> flow review</li></ul>
<p>Action items are tracked in <i>Todo</i>.</p>`;

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — NOTES E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — NOTES E2E ✓`,
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
    body: JSON.stringify({ name: 'Notes Tester', email, password: PASSWORD }),
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
    await db.query(`delete from "note" where "user_id" in (select id from "user" where email like 'e2e-notes-%')`);
    await db.query(`delete from "workspace_file" where "user_id" in (select id from "user" where email like 'e2e-notes-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-notes-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-notes-%')`);
    await db.query(`delete from "user" where email like 'e2e-notes-%'`);
    return 'stale notes e2e rows removed';
  });

  const cookieA = await step('signup user A → verify → session cookie', () => signIn(EMAIL_A));

  await step('anon GET /files → 401', async () => {
    const { res } = await api('GET', '/files');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'service rejects anonymous access';
  });

  let general;
  await step('create root folders + files (positions 0..1)', async () => {
    const g = await api('POST', '/files', { cookie: cookieA, body: { name: 'General', type: 'folder' } });
    if (g.res.status !== 201 && g.res.status !== 200) {
      throw new Error(`folder create → ${g.res.status} ${JSON.stringify(g.json).slice(0, 200)}`);
    }
    general = g.json;
    const i = await api('POST', '/files', { cookie: cookieA, body: { name: 'Ideas', type: 'folder' } });
    if (!(i.json.position > general.position)) throw new Error('positions not appended');
    const w = await api('POST', '/files', {
      cookie: cookieA,
      body: { name: 'welcome.html', type: 'file', parentId: general.id, content: '<h1>Welcome</h1><p>hello world</p>' },
    });
    if (w.res.status !== 201 && w.res.status !== 200) throw new Error(`file create → ${w.res.status}`);
    const m = await api('POST', '/files', {
      cookie: cookieA,
      body: { name: 'meeting-notes.html', type: 'file', parentId: general.id, content: MEETING_HTML },
    });
    if (m.res.status !== 201 && m.res.status !== 200) throw new Error(`file create 2 → ${m.res.status}`);
    const { rows } = await db.query(
      `select position, type from "workspace_file"
       where "user_id" = (select id from "user" where email = $1) and "parent_id" = $2 order by position`,
      [EMAIL_A, general.id],
    );
    const positions = rows.map((r) => Number(r.position));
    if (JSON.stringify(positions) !== JSON.stringify([0, 1])) throw new Error(`sibling positions ${positions}`);
    if (rows.some((r) => r.type === 'folder')) throw new Error('files created as folders?');
    return '2 folders + 2 files, gap-free positions';
  });

  await step('create validation: non-.html file → 400, duplicate name → 409, folder content → 400', async () => {
    const noExt = await api('POST', '/files', { cookie: cookieA, body: { name: 'scratch', type: 'file' } });
    if (noExt.res.status !== 400) throw new Error(`non-.html → ${noExt.res.status}`);
    const dup = await api('POST', '/files', { cookie: cookieA, body: { name: 'welcome.html', type: 'file', parentId: general.id } });
    if (dup.res.status !== 409) throw new Error(`duplicate → ${dup.res.status}`);
    const dupCase = await api('POST', '/files', { cookie: cookieA, body: { name: 'WELCOME.HTML', type: 'file', parentId: general.id } });
    if (dupCase.res.status !== 409) throw new Error(`case-insensitive duplicate → ${dupCase.res.status}`);
    const folderContent = await api('POST', '/files', { cookie: cookieA, body: { name: 'X', type: 'folder', content: '<p>x</p>' } });
    if (folderContent.res.status !== 400) throw new Error(`folder content → ${folderContent.res.status}`);
    const badParent = await api('POST', '/files', { cookie: cookieA, body: { name: 'a.html', type: 'file', parentId: '00000000-0000-4000-8000-000000000000' } });
    if (badParent.res.status !== 404) throw new Error(`unknown parent → ${badParent.res.status}`);
    const fileParent = await api('GET', '/files?parentId=x-not-uuid', { cookie: cookieA });
    if (fileParent.res.status !== 400) throw new Error(`bad uuid query → ${fileParent.res.status}`);
    return '400/409/404 contracts hold';
  });

  let welcomeId;
  await step('tree → nested structure in creation order', async () => {
    const { res, json } = await api('GET', '/files/tree', { cookie: cookieA });
    if (res.status !== 200) throw new Error(`tree → ${res.status}`);
    const names = json.map((n) => n.name);
    if (JSON.stringify(names) !== JSON.stringify(['General', 'Ideas'])) throw new Error(`roots ${names}`);
    const kids = json[0].children.map((c) => `${c.name}:${c.type}`);
    if (JSON.stringify(kids) !== JSON.stringify(['welcome.html:file', 'meeting-notes.html:file'])) {
      throw new Error(`children ${kids}`);
    }
    welcomeId = json[0].children[0].id;
    if (json[0].children[0].children === undefined) throw new Error('node shape missing children');
    return 'recursive tree, ordered';
  });

  await step('folder contents + filters', async () => {
    const all = await api('GET', `/files?parentId=${general.id}`, { cookie: cookieA });
    if (all.json.total !== 2) throw new Error(`total ${all.json.total}`);
    const files = await api('GET', `/files?parentId=${general.id}&type=file`, { cookie: cookieA });
    if (files.json.total !== 2) throw new Error(`type=file total ${files.json.total}`);
    const folders = await api('GET', '/files?type=folder', { cookie: cookieA });
    if (folders.json.total !== 2) throw new Error(`root folders total ${folders.json.total}`);
    const search = await api('GET', `/files?parentId=${general.id}&search=meeting`, { cookie: cookieA });
    if (search.json.total !== 1) throw new Error(`search total ${search.json.total}`);
    const wild = await api('GET', `/files?parentId=${general.id}&search=meet%25`, { cookie: cookieA });
    if (wild.json.total !== 0) throw new Error('unescaped wildcard matched');
    // Root listing must NOT contain the nested files.
    const root = await api('GET', '/files', { cookie: cookieA });
    if (root.json.total !== 2) throw new Error(`root total ${root.json.total}`);
    return 'parentId/type/search filters work';
  });

  await step('note content roundtrip: file create seeds a note', async () => {
    const { res, json } = await api('GET', `/notes/${welcomeId}`, { cookie: cookieA });
    if (res.status !== 200) throw new Error(`get note → ${res.status}`);
    if (json.content !== '<h1>Welcome</h1><p>hello world</p>') throw new Error(`content mismatch ${json.content}`);
    if (json.fileName !== 'welcome.html') throw new Error('fileName missing');
    return 'created-with content returned';
  });

  let meetingUpdateStamp;
  await step('PATCH note content + updatedAt advance', async () => {
    const before = await api('GET', `/notes/${welcomeId}`, { cookie: cookieA });
    const patch = await api('PATCH', `/notes/${welcomeId}`, {
      cookie: cookieA,
      body: { content: '<h2>Team sync — agenda</h2><ul><li>Ship the onboarding review</li></ul><p>Action items in Todo.</p>' },
    });
    if (patch.res.status !== 200 && patch.res.status !== 201) throw new Error(`patch → ${patch.res.status}`);
    if (patch.json.content.includes('<p>hello world</p>')) throw new Error('content not replaced');
    if (new Date(patch.json.updatedAt) < new Date(before.json.updatedAt)) throw new Error('updatedAt did not advance');
    meetingUpdateStamp = patch.json.updatedAt;
    return 'content replaced + updatedAt stamped';
  });

  await step('notes list: search matches content (tags ignored) + wildcards escaped', async () => {
    const hit = await api('GET', '/notes?search=action%20items', { cookie: cookieA });
    if (hit.json.total < 1) throw new Error(`content search ${hit.json.total}`);
    const byName = await api('GET', '/notes?search=onboarding', { cookie: cookieA });
    if (byName.json.total < 1) throw new Error(`name search ${byName.json.total}`);
    const wild = await api('GET', '/notes?search=Team%25', { cookie: cookieA });
    if (wild.json.total !== 0) throw new Error('unescaped wildcard matched');
    const item = hit.json.items[0];
    if (item.content !== undefined) throw new Error('list leaks full content');
    if (!item.preview || item.preview.length > 200) throw new Error(`preview broken ${JSON.stringify(item.preview)}`);
    expectPagination(hit.json);
    return 'search + preview + envelope ok';
  });

  await step('notes list: folderId filter + sort by fileName + pagination', async () => {
    const inFolder = await api('GET', `/notes?folderId=${general.id}`, { cookie: cookieA });
    if (inFolder.json.total !== 2) throw new Error(`folder filter ${inFolder.json.total}`);
    const sorted = await api('GET', '/notes?sortBy=fileName&sortOrder=asc', { cookie: cookieA });
    const names = sorted.json.items.map((n) => n.fileName);
    if (JSON.stringify(names) !== JSON.stringify([...names].sort((a, b) => a.localeCompare(b)))) {
      throw new Error(`not sorted ${names}`);
    }
    const paged = await api('GET', '/notes?page=2&limit=1', { cookie: cookieA });
    if (paged.json.page !== 2 || paged.json.totalPages !== 2) throw new Error(`envelope ${JSON.stringify({ page: paged.json.page, totalPages: paged.json.totalPages })}`);
    expectPagination(paged.json);
    return 'folderId + sort + pagination ok';
  });

  await step('notes validation: folder id → 400, unknown id → 404, bad uuid → 400', async () => {
    const { json: tree } = await api('GET', '/files/tree', { cookie: cookieA });
    const folderId = tree[0].id;
    const folderNote = await api('GET', `/notes/${folderId}`, { cookie: cookieA });
    if (folderNote.res.status !== 400) throw new Error(`folder as note → ${folderNote.res.status}`);
    const patchFolder = await api('PATCH', `/notes/${folderId}`, { cookie: cookieA, body: { content: 'x' } });
    if (patchFolder.res.status !== 400) throw new Error(`patch folder → ${patchFolder.res.status}`);
    const unknown = await api('GET', '/notes/00000000-0000-4000-8000-000000000000', { cookie: cookieA });
    if (unknown.res.status !== 404) throw new Error(`unknown → ${unknown.res.status}`);
    const bad = await api('GET', '/notes/not-a-uuid', { cookie: cookieA });
    if (bad.res.status !== 400) throw new Error(`bad uuid → ${bad.res.status}`);
    const emptyPatch = await api('PATCH', `/notes/${welcomeId}`, { cookie: cookieA, body: {} });
    if (emptyPatch.res.status !== 400) throw new Error(`empty body → ${emptyPatch.res.status}`);
    return '400/404 contracts hold';
  });

  await step('rename file keeps .html contract; bad rename → 400', async () => {
    const ok = await api('PATCH', `/files/${welcomeId}`, { cookie: cookieA, body: { name: 'intro.html' } });
    if (ok.res.status !== 200 && ok.res.status !== 201) throw new Error(`rename → ${ok.res.status}`);
    if (ok.json.name !== 'intro.html') throw new Error(`name ${ok.json.name}`);
    const bad = await api('PATCH', `/files/${welcomeId}`, { cookie: cookieA, body: { name: 'intro' } });
    if (bad.res.status !== 400) throw not400('non-.html rename', bad.res.status);
    const note = await api('GET', '/notes?search=intro.html', { cookie: cookieA });
    if (note.json.total !== 1) throw new Error('renamed file not searchable');
    return 'rename works, extension enforced';
  });

  let ideasId;
  await step('move file between folders (positions recompute)', async () => {
    const { json: tree } = await api('GET', '/files/tree', { cookie: cookieA });
    ideasId = tree[1].id;
    const move = await api('PATCH', `/files/${welcomeId}`, { cookie: cookieA, body: { parentId: ideasId } });
    if (move.res.status !== 200 && move.res.status !== 201) throw new Error(`move → ${move.res.status}`);
    if (move.json.parentId !== ideasId) throw new Error(`parentId ${move.json.parentId}`);
    const src = await api('GET', `/files?parentId=${general.id}`, { cookie: cookieA });
    if (src.json.total !== 1) throw new Error(`source folder count ${src.json.total}`);
    const { rows } = await db.query(
      `select position from "workspace_file"
       where "user_id" = (select id from "user" where email = $1) and "parent_id" = $2 order by position`,
      [EMAIL_A, general.id],
    );
    const positions = rows.map((r) => Number(r.position));
    if (JSON.stringify(positions) !== JSON.stringify([0])) throw new Error(`source positions ${positions}`);
    return 'moved + source gap closed';
  });

  let subId;
  await step('nested folders + cycle protection', async () => {
    const sub = await api('POST', '/files', { cookie: cookieA, body: { name: 'Web', type: 'folder', parentId: ideasId } });
    if (sub.res.status !== 201 && sub.res.status !== 200) throw new Error(`subfolder → ${sub.res.status}`);
    subId = sub.json.id;
    // Move General (folder) into Ideas/Web — legal.
    const move = await api('PATCH', `/files/${general.id}`, { cookie: cookieA, body: { parentId: subId } });
    if (move.res.status !== 200 && move.res.status !== 201) throw new Error(`nest folder → ${move.res.status}`);
    // Now Ideas is an ancestor of General — moving Ideas into General = cycle → 400.
    const cycle = await api('PATCH', `/files/${ideasId}`, { cookie: cookieA, body: { parentId: general.id } });
    if (cycle.res.status !== 400) throw new Error(`cycle → ${cycle.res.status}`);
    const self = await api('PATCH', `/files/${ideasId}`, { cookie: cookieA, body: { parentId: ideasId } });
    if (self.res.status !== 400) throw new Error(`self-move → ${self.res.status}`);
    const { json: tree } = await api('GET', '/files/tree', { cookie: cookieA });
    if (tree.length !== 1 || tree[0].id !== ideasId) throw new Error('tree root not Ideas');
    const web = tree[0].children.find((c) => c.id === subId);
    if (!web) throw new Error('Web subfolder missing from Ideas children');
    const generalNode = web.children.find((c) => c.id === general.id);
    if (!generalNode) throw new Error('General not nested under Ideas/Web');
    return 'nesting ok; self/cycle moves rejected';
  });

  let cookieB;
  let introForeignId;
  await step('user B isolation: B cannot read/modify A’s files/notes', async () => {
    const { json: tree } = await api('GET', '/files/tree', { cookie: cookieA });
    introForeignId = tree[0].children[0].id;
    cookieB = await signIn(EMAIL_B);
    const own = await api('GET', '/files/tree', { cookie: cookieB });
    if (own.json.length !== 0) throw new Error(`B sees ${own.json.length} root rows of A`);
    const notesOwn = await api('GET', '/notes', { cookie: cookieB });
    if (notesOwn.json.total !== 0) throw new Error(`B sees ${notesOwn.json.total} notes of A`);
    const foreign = await api('GET', `/notes/${introForeignId}`, { cookie: cookieB });
    if (foreign.res.status !== 404) throw new Error(`GET foreign note → ${foreign.res.status}`);
    const patchForeign = await api('PATCH', `/notes/${introForeignId}`, { cookie: cookieB, body: { content: 'hacked' } });
    if (patchForeign.res.status !== 404) throw new Error(`PATCH foreign note → ${patchForeign.res.status}`);
    const renameForeign = await api('PATCH', `/files/${introForeignId}`, { cookie: cookieB, body: { name: 'hacked.html' } });
    if (renameForeign.res.status !== 404) throw new Error(`PATCH foreign file → ${renameForeign.res.status}`);
    const delForeign = await api('DELETE', `/files/${introForeignId}`, { cookie: cookieB });
    if (delForeign.res.status !== 404) throw new Error(`DELETE foreign → ${delForeign.res.status}`);
    return 'full isolation (404 on read/patch/delete)';
  });

  await step('delete file cascades its note (DB check)', async () => {
    const del = await api('DELETE', `/files/${introForeignId}`, { cookie: cookieA });
    if (del.res.status !== 200 && del.res.status !== 201) throw new Error(`delete → ${del.res.status}`);
    const { rows } = await db.query(`select count(*)::int as c from "note" where "file_id" = $1`, [introForeignId]);
    if (rows[0].c !== 0) throw new Error('note row survived file delete');
    const note = await api('GET', `/notes/${introForeignId}`, { cookie: cookieA });
    if (note.res.status !== 404) throw new Error(`deleted note still reachable → ${note.res.status}`);
    return 'cascade verified';
  });

  await step('delete folder cascades descendants + notes (DB check)', async () => {
    const del = await api('DELETE', `/files/${ideasId}`, { cookie: cookieA });
    if (del.res.status !== 200 && del.res.status !== 201) throw new Error(`delete folder → ${del.res.status}`);
    const { rows } = await db.query(
      `select
        (select count(*)::int from "workspace_file" where "user_id" = (select id from "user" where email = $1)) as files,
        (select count(*)::int from "note" where "user_id" = (select id from "user" where email = $1)) as notes`,
      [EMAIL_A],
    );
    if (rows[0].files !== 0 || rows[0].notes !== 0) {
      throw new Error(`cascade incomplete: files=${rows[0].files} notes=${rows[0].notes}`);
    }
    return 'recursive cascade verified';
  });

  await step('e2e cleanup (DB rows)', async () => {
    await db.query(`delete from "note" where "user_id" in (select id from "user" where email like 'e2e-notes-%')`);
    await db.query(`delete from "workspace_file" where "user_id" in (select id from "user" where email like 'e2e-notes-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-notes-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-notes-%')`);
    await db.query(`delete from "user" where email like 'e2e-notes-%'`);
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

function expectPagination(json) {
  for (const key of ['total', 'page', 'limit', 'totalPages']) {
    if (typeof json[key] !== 'number') throw new Error(`envelope missing ${key}`);
  }
}

function not400(label, status) {
  return new Error(`${label} → ${status}, want 400`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
