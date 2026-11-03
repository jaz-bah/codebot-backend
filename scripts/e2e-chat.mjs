/**
 * Chat E2E — scripted HTTP + Socket.IO checks against a running server.
 * Requires: server booted (npm start / start:dev) + .mail-capture.jsonl dev mode.
 *
 *  1. signup A & B WITH usernames → verified session cookies
 *  2. anon access → 401
 *  3. people search by username (case-insensitive substring; caller excluded;
 *     username-less users invisible; existing conversationId echoed)
 *  4. start by username (case-insensitivity) + duplicate prevention (1 conversation in DB)
 *  5. validation: unknown username → 404, own username → 400, bad body → 400
 *  6. conversation list (other user + last message + unread count)
 *  7. message pagination (newest first envelope)
 *  8. isolation: stranger gets 404 on foreign conversation
 *  9. read receipts (sender messages only) + unread flips
 * 10. WS: cookie-authenticated connect; anonymous connect rejected;
 *     message:new broadcast to recipient + te sender; messages:read to sender
 */
import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { io } from 'socket.io-client';

const BASE = `http://localhost:${process.env.PORT || 3000}`;
const STAMP = Date.now();
const USERNAME_A = `e2echata${STAMP % 100000}`;
const USERNAME_B = `e2echatb${STAMP % 100000}`;
const EMAIL_A = `e2e-chat-a-${STAMP}@test.local`;
const EMAIL_B = `e2e-chat-b-${STAMP}@test.local`;
const PASSWORD = 'chat-password-123';
const ORIGIN = (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173').split(',')[0].trim();

const results = [];

function printSummary() {
  const fails = results.filter(([, s]) => s === 'FAIL');
  console.log(
    fails.length
      ? `\nRESULT: ${results.length - fails.length}/${results.length} steps passed — CHAT E2E FAILED`
      : `\nRESULT: ${results.length}/${results.length} steps passed — CHAT E2E ✓`,
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

async function signUp({ email, username }) {
  const r1 = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ name: 'Chat Tester', email, password: PASSWORD, username }),
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

const connectChatSocket = (cookie) =>
  new Promise((resolve, reject) => {
    const socket = io(`${BASE}/chat`, {
      extraHeaders: { cookie, origin: ORIGIN },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') reject(new Error('server disconnected (unauthorized?)'));
    });
    setTimeout(() => reject(new Error('ws connect timeout')), 6000);
  });

/**
 * The server rejects anonymous sockets AFTER the namespace connect completes
 * (`connect` → `unauthorized` → `io server disconnect`) — resolving on
 * `connect` alone always wins that race. Instead resolve when eviction
 * happens (connect_error OR post-connect server disconnect) and reject if the
 * socket is still alive after a grace window (i.e. it was accepted).
 */
const expectSocketRejection = (cookie, graceMs = 4000) =>
  new Promise((resolveRejected, rejectAlive) => {
    const socket = io(`${BASE}/chat`, {
      extraHeaders: { cookie, origin: ORIGIN },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      timeout: 5000,
    });
    let done = false;
    const finish = (why) => {
      if (done) return;
      done = true;
      socket.disconnect();
      resolveRejected(why);
    };
    socket.on('connect_error', (err) => finish(`connect_error: ${err.message}`));
    socket.on('connect', () => {
      socket.on('disconnect', (reason) =>
        finish(reason === 'io server disconnect' ? 'io server disconnect' : `disconnect: ${reason}`));
    });
    setTimeout(() => rejectAlive(new Error('anonymous socket was accepted (alive after 4s)')), graceMs);
  });

const waitFor = (socket, event, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

async function main() {
  const step = async (name, fn) => {
    try {
      const value = await fn();
      results.push([name, 'PASS', value ?? '']);
      console.log(`[PASS] ${name}${value ? ' — ' + (value.length ? String(value).slice(0, 60) + '…' : value) : ''}`);
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

  let socketA, socketB;
  let cookieA, cookieB;
  let userAId, userBId;
  let conversationId;

  const cleanupLike = async () => {
    await db.query(`delete from "conversation" where
      "user_a_id" in (select id from "user" where email like 'e2e-chat-%')
      or "user_b_id" in (select id from "user" where email like 'e2e-chat-%')`);
    await db.query(`delete from "session" where "userId" in (select id from "user" where email like 'e2e-chat-%')`);
    await db.query(`delete from "account" where "userId" in (select id from "user" where email like 'e2e-chat-%')`);
    await db.query(`delete from "user" where email like 'e2e-chat-%'`);
  };

  await step('cleanup stale rows', () => cleanupLike().then(() => 'stale chat rows removed'));

  cookieA = await step('signup A (username) → verify → cookie', () => signUp({ email: EMAIL_A, username: USERNAME_A }));
  cookieB = await step('signup B (username) → verify → cookie', () => signUp({ email: EMAIL_B, username: USERNAME_B }));

  await step('user ids resolved from DB', async () => {
    const { rows } = await db.query(`select id, username from "user" where email in ($1,$2) order by email`, [EMAIL_A, EMAIL_B]);
    userAId = rows.find((r) => r.username === USERNAME_A).id;
    userBId = rows.find((r) => r.username === USERNAME_B).id;
    if (!userAId || !userBId) throw new Error('user rows missing after signup');
    return `A=${userAId.slice(0, 8)}… B=${userBId.slice(0, 8)}…`;
  });

  await step('anon GET /chat/users → 401', async () => {
    const { res } = await api('GET', '/chat/users');
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
    return 'service rejects anonymous access';
  });

  await step('AA search: B found by username (case-insensitive), A excluded', async () => {
    const { res, json } = await api('GET', `/chat/users?q=${USERNAME_B.toUpperCase().slice(0, 7)}`, { cookie: cookieA });
    if (res.status !== 200) throw new Error(`search → ${res.status}`);
    if (json.length !== 1) throw new Error(`expected 1 hit, got ${json.length}`);
    if (json[0].id !== userBId || json[0].username !== USERNAME_B) throw new Error(`bad hit ${JSON.stringify(json[0])}`);
    if (json[0].conversationId !== null) throw new Error('conversationId should be null before thread exists');
    return 'exact case-insensitive match, self excluded';
  });

  await step('search pagination: limit honored', async () => {
    const { json } = await api('GET', '/chat/users?limit=1', { cookie: cookieA });
    if (json.length !== 1) throw new Error(`limit not honored: ${json.length}`);
    return 'limit=1 → 1 row';
  });

  let started;
  await step('start conversation by username (mixed case → lower-normalized find)', async () => {
    const { res, json } = await api('POST', '/chat/conversations', {
      cookie: cookieA,
      body: { username: USERNAME_B.toUpperCase() }, // plugin stores lowercase
    });
    if (res.status !== 201) throw new Error(`start → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    started = json;
    conversationId = json.id;
    if (json.created !== true) throw new Error(`expected created:true, got ${json.created}`);
    if (json.otherUser.username !== USERNAME_B) throw new Error(`otherUser mismatch ${JSON.stringify(json.otherUser)}`);
    const { rows } = await db.query(
      `select "user_a_id", "user_b_id" from "conversation" where id = $1`, [conversationId],
    );
    if (rows[0].user_a_id !== [userAId, userBId].sort()[0]) throw new Error('canonical ordering broken');
    return 'created:true, canonical pair (a < b) stored';
  });

  await step('duplicate prevention: same start → created:false, same id, one DB row', async () => {
    const { res, json } = await api('POST', '/chat/conversations', {
      cookie: cookieB, // opposite direction must resolve to the SAME conversation
      body: { username: USERNAME_A },
    });
    if (res.status !== 201) throw new Error(`start → ${res.status}`);
    if (json.created !== false) throw new Error(`expected created:false, got ${json.created}`);
    if (json.id !== conversationId) throw new Error(`different conversation id: ${json.id}`);
    const { rows } = await db.query(
      `select id from "conversation" where "user_a_id" = least($1,$2) and "user_b_id" = greatest($1,$2)`,
      [userAId, userBId],
    );
    if (rows.length !== 1) throw new Error(`expected 1 DB row, got ${rows.length}`);
    if (json.otherUser.id !== userAId) throw new Error('otherUser must be A from B’s view');
    if (json.otherUser.username !== USERNAME_A) throw new Error('otherUser username mismatch');
    return 'B starting with A → same thread, created:false';
  });

  await step('start validation: unknown username → 404, self → 400, bad pattern → 400', async () => {
    const unknown = await api('POST', '/chat/conversations', { cookie: cookieA, body: { username: 'ghostuser404' } });
    if (unknown.res.status !== 404) throw new Error(`unknown → ${unknown.res.status}`);
    const self = await api('POST', '/chat/conversations', { cookie: cookieA, body: { username: USERNAME_A } });
    if (self.res.status !== 400) throw new Error(`self → ${self.res.status}`);
    const bad = await api('POST', '/chat/conversations', { cookie: cookieA, body: { username: 'has space' } });
    if (bad.res.status !== 400) throw new Error(`bad pattern → ${bad.res.status}`);
    return '404/400/400 verified';
  });

  await step('conversation list: other user + unread 0 (empty thread)', async () => {
    const { json } = await api('GET', '/chat/conversations', { cookie: cookieA });
    if (json.total !== 1 || json.items.length !== 1) throw new Error(`bad list envelope ${JSON.stringify(json).slice(0, 120)}`);
    const item = json.items[0];
    if (item.id !== conversationId || item.otherUser.id !== userBId) throw new Error('list item mismatch');
    if (item.unreadCount !== 0 || item.lastMessage !== null) throw new Error('fresh thread should have no messages');
    return '1 conversation, unreadCount 0, no lastMessage';
  });

  await step('WS connect as B (cookie-authenticated); anon connect rejected', async () => {
    socketB = await connectChatSocket(cookieB);
    const hi = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('whoami timeout')), 3000);
      socketB.emit('whoami', (resp) => { clearTimeout(t); resolve(resp); });
    });
    if (hi.userId !== userBId) throw new Error(`whoami → ${JSON.stringify(hi)}`);

    const how = await expectSocketRejection('better-auth.badcookie=1');
    return `B connected (${socketB.id.slice(0, 6)}…); anon socket rejected (${how})`;
  });

  await step('send message A→B: persisted + stamped + broadcast', async () => {
    const wsPromise = waitFor(socketB, 'message:new');
    const { res, json } = await api('POST', `/chat/conversations/${conversationId}/messages`, {
      cookie: cookieA,
      body: { content: '  Hello beta! ' },
    });
    if (res.status !== 201) throw new Error(`send → ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    if (json.message.content !== 'Hello beta!') throw new Error(`content not trimmed: ${json.message.content}`);
    if (json.message.isRead !== false) throw new Error('new message must be unread');

    const ws = await wsPromise;
    if (ws.message.id !== json.message.id) throw new Error('broadcast id mismatch');
    if (ws.conversationId !== conversationId) throw new Error('broadcast conversation mismatch');
    return `message id=${json.message.id.slice(0, 8)}… broadcast to B`;
  });

  await step('send 4 more → 5 total; unreadCount(B)=5', async () => {
    for (let i = 2; i <= 5; i++) {
      const { res } = await api('POST', `/chat/conversations/${conversationId}/messages`, {
        cookie: cookieA, body: { content: `Message number ${i}` },
      });
      if (res.status !== 201) throw new Error(`send ${i} → ${res.status}`);
    }
    const { json } = await api('GET', '/chat/conversations', { cookie: cookieB });
    if (json.total !== 1 || json.items.length !== 1) throw new Error('list broken');
    const item = json.items[0];
    if (item.otherUser.id !== userAId) throw new Error('B must see A as otherUser');
    if (item.unreadCount !== 5) throw new Error(`B unread ${item.unreadCount}, want 5`);
    if (item.lastMessage.content !== 'Message number 5') throw new Error(`lastMessage wrong: ${item.lastMessage.content}`);
    if (item.lastMessage.senderId !== userAId) throw new Error('lastMessage sender wrong');
    return 'unread 5, lastMessage = newest';
  });

  await step('message history pagination: 5 total, newest-first pages', async () => {
    const p1 = await api('GET', `/chat/conversations/${conversationId}/messages?page=2&limit=2`, { cookie: cookieA });
    if (p1.json.total !== 5 || p1.json.totalPages !== 3 || p1.json.page !== 2) {
      throw new Error(`envelope broken: ${JSON.stringify(p1.json).slice(0, 140)}`);
    }
    const contents = p1.json.items.map((m) => m.content);
    const all = (await api('GET', `/chat/conversations/${conversationId}/messages?limit=100`, { cookie: cookieA })).json
      .items.map((m) => m.content);
    if (JSON.stringify(contents) !== JSON.stringify(['Message number 3', 'Message number 2'])) {
      throw new Error(`page 2 wrong order: ${JSON.stringify(contents)}`);
    }
    if (all[0] !== 'Message number 5' || all.length !== 5) throw new Error(`full list broken: ${all.length}`);

    const params = await api('GET', `/chat/conversations/${conversationId}/messages?limit=0`, { cookie: cookieA });
    if (params.res.status !== 400) throw new Error(`limit=0 → ${params.res.status}, want 400`);
    return 'pages + params validated';
  });

  let cCookie;
  await step('isolation: stranger cannot open or write to A∩B thread', async () => {
    cCookie = await signUp({
      email: `e2e-chat-c-${STAMP}@test.local`,
      username: `e2echatc${STAMP % 100000}`,
    });
    const read = await api('GET', `/chat/conversations/${conversationId}/messages`, { cookie: cCookie });
    if (read.res.status !== 404) throw new Error(`stranger read → ${read.res.status}, want 404`);
    const write = await api('POST', `/chat/conversations/${conversationId}/messages`, {
      cookie: cCookie, body: { content: 'intrusion' },
    });
    if (write.res.status !== 404) throw new Error(`stranger write → ${write.res.status}, want 404`);
    const whatever = await api('GET', `/chat/conversations/00000000-0000-4000-8000-000000000000/messages`, { cookie: cookieA });
    if (whatever.res.status !== 404) throw new Error(`missing conversation → ${whatever.res.status}`);
    return '404 for strangers and unknown ids';
  });

  await step('read receipts: read flags flip; A sees messages:read via WS', async () => {
    const senderRead = io(`${BASE}/chat`, {
      extraHeaders: { cookie: cookieA, origin: ORIGIN },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    await new Promise((r, j) => { senderRead.on('connect', r); senderRead.on('connect_error', j); setTimeout(() => j(new Error('ws A timeout')), 5000); });

    const unreadBefore = (await api('GET', '/chat/conversations', { cookie: cookieA })).json.items[0].unreadCount;
    if (unreadBefore !== 0) throw new Error(`A's own unread should be 0, got ${unreadBefore}`);

    // Arm the WS listener FIRST: the server fans `messages:read` out right
    // after the DB transaction, BEFORE the PATCH HTTP response resolves —
    // attaching it after `await api(...)` would always lose the race.
    const senderEventPromise = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('messages:read not received')), 4000);
      senderRead.once('messages:read', (p) => { clearTimeout(t); resolve(p); });
    });

    const { res, json } = await api('PATCH', `/chat/conversations/${conversationId}/read`, { cookie: cookieB });
    if (res.status !== 200) throw new Error(`read → ${res.status}`);
    if (json.markedRead !== 5) throw new Error(`markedRead ${json.markedRead}, want 5`);
    if (json.readByUserId !== userBId) throw new Error('readByUserId wrong');

    const senderEvent = await senderEventPromise;
    if (senderEvent.readByUserId !== userBId) throw new Error('A-side read event wrong payload');

    const { json: list2 } = await api('GET', '/chat/conversations', { cookie: cookieB });
    if (list2.items[0].unreadCount !== 0) throw new Error('B unread not zeroed after read');
    if (list2.items[0].lastMessage.isRead !== true) throw new Error('lastMessage not flagged read');
    const { rows } = await db.query(
      `select count(*)::int as n from "message" where "conversation_id" = $1 and "sender_id" = $2 and "is_read"`,
      [conversationId, userAId],
    );
    if (rows[0].n !== 5) throw new Error(`DB read flags: ${rows[0].n}/5`);
    senderRead.disconnect();
    return '5 flipped (own untouched), WS read fan-out verified';
  });

  await step('WS message when recipient OFFLINE still lands via REST', async () => {
    socketB.disconnect();
    const { res } = await api('POST', `/chat/conversations/${conversationId}/messages`, {
      cookie: cookieA, body: { content: 'async ping' },
    });
    if (res.status !== 201) throw new Error(`send → ${res.status}`);
    const { json } = await api('GET', `/chat/conversations/${conversationId}/messages?limit=1`, { cookie: cookieB });
    if (json.items[0].content !== 'async ping') throw new Error('offline delivery lost');
    return 'offline recipient covered by REST';
  });

  await step('e2e cleanup (DB rows)', async () => {
    await cleanupLike();
    const { rows } = await db.query(
      `select count(*)::int as n from "conversation" c
       join "user" u on u.id = c."user_a_id" or u.id = c."user_b_id"
       where u.email like 'e2e-chat-%'`,
    );
    if (rows[0].n !== 0) throw new Error('chat rows not cleaned');
    if (socketA) socketA.disconnect();
    if (socketB) socketB.disconnect();
    await db.end();
    return 'DB cleaned';
  });

  printSummary();
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  printSummary();
});
