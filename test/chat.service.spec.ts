import { ChatService } from '../src/modules/chat/chat.service';
import { ChatGateway } from '../src/modules/chat/chat.gateway';

/**
 * ChatService unit tests against a hand-rolled DataSource stub (same style as
 * todos.service.spec.ts) — no real DB. Raw SQL searching/membership/read paths
 * are exercised with canned row sets; transactional behavior (send + stamp,
 * duplicate prevention, race re-read) through the fake repos.
 */

interface ConversationLike {
  id: string;
  userAId: string;
  userBId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface MessageLike {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  isRead: boolean;
  readAt?: Date | null;
  createdAt: Date;
}

/** Match rows by the named-parameters of each canned query in the service. */
class FakeDb {
  users: { id: string; username: string | null; name: string; image: string | null }[] = [];
  conversations: ConversationLike[] = [];
  messages: MessageLike[] = [];
  queries: { sql: string; values: unknown[] }[] = [];

  async query(sql: string, values: unknown[] = []): Promise<unknown[]> {
    this.queries.push({ sql, values });
    const s = sql.replace(/\s+/g, ' ');
    const q = async () => [];

    if (s.includes('FROM "user" WHERE lower(username) = lower')) {
      const uname = String(values[0] ?? '').trim().toLowerCase();
      return this.users.filter(
        (u) => u.username && u.username.toLowerCase() === uname,
      );
    }
    if (s.includes('FROM "user" u') && s.includes('LIKE $3')) {
      const pattern = String(values[2]).replace(/%/g, '').toLowerCase();
      return this.users
        .filter(
          (u) =>
            u.id !== values[0] &&
            u.username &&
            u.username.toLowerCase().includes(pattern),
        )
        .slice(0, Number(values[1]))
        .map((u) => ({ id: u.id, username: u.username, name: u.name, image: u.image, conversationId: this.conversationIdFor(u.id, String(values[0])) }));
    }
    if (s.includes('FROM "user" u') && s.includes('ORDER BY u.username ASC LIMIT $2')) {
      const callerId = String(values[0]);
      return this.users
        .filter((u) => u.id !== callerId && u.username)
        .slice(0, Number(values[1]))
        .map((u) => ({
          id: u.id,
          username: u.username,
          name: u.name,
          image: u.image,
          conversationId: this.conversationIdFor(u.id, callerId),
        }));
    }
    if (s.includes('SELECT c."user_a_id", c."user_b_id"')) {
      const conv = this.conversations.find((c) => c.id === values[0]);
      return conv ? [{ user_a_id: conv.userAId, user_b_id: conv.userBId }] : [];
    }
    if (s.startsWith('SELECT id, "created_at", "updated_at"')) {
      const conv = this.conversations.find((c) => c.id === values[0]);
      return conv
        ? [{ id: conv.id, created_at: conv.createdAt, updated_at: conv.updatedAt }]
        : [];
    }
    if (s.includes('SELECT count(*)::int')) {
      if (s.includes('FROM "conversation"')) {
        const callerId = String(values[0]);
        return [
          { cnt: this.conversations.filter((c) => c.userAId === callerId || c.userBId === callerId).length },
        ];
      }
      if (s.includes('FROM "message"') && s.includes('"is_read" = false')) {
        const [conversationId, recipientId] = values as [string, string];
        return [
          {
            cnt: this.messages.filter(
              (m) =>
                m.conversationId === conversationId &&
                m.senderId !== recipientId &&
                !m.isRead,
            ).length,
          },
        ];
      }
      const conversationId = String(values[0]);
      return [{ cnt: this.messages.filter((m) => m.conversationId === conversationId).length }];
    }
    if (s.includes('SELECT id, username, name, image FROM "user" WHERE id = $1')) {
      const u = this.users.find((x) => x.id === values[0]);
      return u ? [u] : [];
    }
    if (s.startsWith('SELECT id, "conversation_id", "sender_id", content')) {
      const [conversationId, limit, offset] = values as [string, number, number];
      const rows = this.messages
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(offset, offset + limit)
        .map((m) => ({
          id: m.id,
          conversation_id: m.conversationId,
          sender_id: m.senderId,
          content: m.content,
          is_read: m.isRead,
          read_at: m.readAt ?? null,
          created_at: m.createdAt,
        }));
      return rows;
    }
    if (s.startsWith('SELECT id, content, "sender_id", "created_at", "is_read"')) {
      const rows = this.messages
        .filter((m) => m.conversationId === values[0])
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 1)
        .map((m) => ({
          id: m.id,
          content: m.content,
          sender_id: m.senderId,
          created_at: m.createdAt,
          is_read: m.isRead,
        }));
      return rows;
    }
    return q();
  }

  conversationIdFor(targetId: string, callerId: string): string | null {
    const [a, b] = [callerId, targetId].sort();
    return this.conversations.find((c) => c.userAId === a && c.userBId === b)?.id ?? null;
  }
}

/** Fake transactional EntityManager: repositories created per entity class. */
class FakeEm {
  private qbs: FakeQb[] = [];
  constructor(
    private readonly db: FakeDb,
    private readonly injectedError?: unknown & { code?: string },
  ) {}
  data() {
    return this.db;
  }
  getRepository() {
    return new FakeRepo(this.db, this.injectedError, this.qbs);
  }
  qbUpdates() {
    return this.qbs;
  }
}

/** Records create/save/findOne over both entity types (discriminated by shape). */
class FakeRepo {
  constructor(
    private readonly db: FakeDb,
    private readonly injectedError?: unknown & { code?: string },
    private readonly qbs: FakeQb[] = [],
  ) {}

  async findOne(criteria: unknown): Promise<unknown | undefined> {
    const c = criteria as { where: { userAId?: string; userBId?: string; id?: string } };
    const w = c.where;
    if (w.userAId || w.userBId) {
      return this.db.conversations.find(
        (conv) => conv.userAId === w.userAId && conv.userBId === w.userBId,
      );
    }
    return this.db.conversations.find((conv) => conv.id === w.id);
  }

  create(entity: { userAId?: string; userBId?: string; conversationId?: string } & Partial<MessageLike> & Partial<ConversationLike>) {
    if ('content' in entity) return { ...entity } as MessageLike & { createdAt?: Date };
    return { ...entity, createdAt: new Date(), updatedAt: new Date() } as ConversationLike;
  }

  async save(entity: Partial<MessageLike> & Partial<ConversationLike>): Promise<unknown> {
    if (this.injectedError) throw this.injectedError;
    if ('conversationId' in entity) {
      const message = {
        id: `msg-${this.db.messages.length + 1}`,
        conversationId: entity.conversationId,
        senderId: entity.senderId ?? '',
        content: entity.content ?? '',
        isRead: false,
        readAt: null,
        createdAt: new Date(),
      } as MessageLike;
      this.db.messages.push(message);
      return message;
    }
    const conversation = {
      id: `conv-${this.db.conversations.length + 1}`,
      userAId: entity.userAId ?? '',
      userBId: entity.userBId ?? '',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ConversationLike;
    this.db.conversations.push(conversation);
    return conversation;
  }

  createQueryBuilder(): FakeQb {
    const qb = new FakeQb(this.db);
    this.qbs.push(qb);
    return qb;
  }
}

class FakeQb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
  wherePayload?: unknown;
  constructor(private readonly db: FakeDb) {}
  update(): FakeQb {
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(payload: any): FakeQb {
    this.payload = payload;
    return this;
  }
  where(sql: unknown, params: unknown): FakeQb {
    this.wherePayload = params;
    return this;
  }
  async execute(): Promise<{ affected: number | undefined }> {
    const w = (this.wherePayload ?? {}) as { id?: string; userId?: string };
    if (this.payload?.isRead === true) {
      // markRead UPDATE: flip unread messages from the other sender.
      let flipped = 0;
      for (const m of this.db.messages) {
        if (
          m.conversationId === w.id &&
          m.senderId !== w.userId &&
          !m.isRead
        ) {
          m.isRead = true;
          m.readAt = new Date();
          flipped++;
        }
      }
      return { affected: flipped };
    }
    const conv = this.db.conversations.find((c) => c.id === w?.id);
    if (conv && typeof this.payload?.updatedAt === 'function') {
      conv.updatedAt = new Date(); // `now()` sql function emulation
    }
    return { affected: conv ? 1 : 0 };
  }
}

const buildService = (db: FakeDb, injectedError?: { code?: string }) => {
  const dataSource = {
    isInitialized: true,
    query: db.query.bind(db),
    transaction: (work: (em: FakeEm) => Promise<unknown>) =>
      work(new FakeEm(db, injectedError)),
  } as never;
  const gateway = {
    broadcastMessage: jest.fn(),
    broadcastConversationUpdated: jest.fn(),
    broadcastRead: jest.fn(),
  } as unknown as ChatGateway;
  const service = new ChatService(dataSource, gateway);
  return { service, gateway, db };
};

const futureDate = (minutesShift: number): Date =>
  new Date(Date.now() + minutesShift * 60_000);

describe('ChatService', () => {
  const USER_A = 'user-a';
  const USER_B = 'user-b';
  const USER_C = 'user-c';

  const seedUsers = (db: FakeDb): void => {
    db.users = [
      { id: USER_A, username: 'alpha', name: 'Alpha', image: null },
      { id: USER_B, username: 'beta', name: 'Beta', image: null },
      { id: USER_C, username: 'gamma', name: 'Gamma', image: null },
      { id: 'user-nb', username: null, name: 'No Berg', image: null },
    ];
  };

  describe('searchUsers', () => {
    it('searches by username substring, case-insensitive, excluding the caller', async () => {
      const db = new FakeDb();
      seedUsers(db);
      const { service } = buildService(db);
      db.queries.length = 0; // seed does not generate queries

      const hits = await service.searchUsers(USER_A, { q: 'Beta', limit: 10 });
      expect(hits.map((h) => h.id)).toEqual([USER_B]);
      // pattern is lower-cased and wildcard-escaped
      const last = db.queries[db.queries.length - 1];
      expect(String(last.values[2])).toBe('%beta%');
      expect(last.values[0]).toBe(USER_A); // caller id always first
    });

    it('escapes LIKE wildcards in the query', async () => {
      const db = new FakeDb();
      seedUsers(db);
      const { service } = buildService(db);
      await service.searchUsers(USER_A, { q: '100%', limit: 10 });
      expect(String(db.queries[db.queries.length - 1].values[2])).toBe('%100\\%%');
    });

    it('hides username-less users and caps the limit', async () => {
      const db = new FakeDb();
      seedUsers(db);
      db.users.push({ id: 'user-x', username: 'xavier', name: 'X', image: null });
      const { service } = buildService(db);
      const hits = await service.searchUsers(USER_A, { limit: 2 });
      expect(hits.every((h) => h.username !== null)).toBe(true);
      expect(hits).toHaveLength(2); // limit respected
      expect(hits.map((h) => h.id)).toEqual([USER_B, USER_C]); // username asc
    });

    it('echoes the existing conversationId for known contacts', async () => {
      const db = new FakeDb();
      seedUsers(db);
      db.conversations.push({
        id: 'conv-1',
        userAId: USER_A,
        userBId: USER_B,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const { service } = buildService(db);
      const hits = await service.searchUsers(USER_A, { limit: 10 });
      expect(hits.find((h) => h.id === USER_B)?.conversationId).toBe('conv-1');
      expect(hits.find((h) => h.id === USER_C)?.conversationId).toBeNull();
    });
  });

  describe('startConversation', () => {
    it('creates a conversation with the CANONICAL (sorted) pair', async () => {
      const db = new FakeDb();
      seedUsers(db);
      const { service } = buildService(db);
      const result = await service.startConversation(USER_C, 'alpha');
      expect(result.created).toBe(true);
      expect(result.otherUser.id).toBe(USER_A);
      expect(result.otherUser.username).toBe('alpha');
      const conv = db.conversations[0];
      expect([conv.userAId, conv.userBId]).toEqual([USER_A, USER_C]); // sorted
      expect(conv.userAId < conv.userBId).toBe(true);
    });

    it('404s on unknown username', async () => {
      const db = new FakeDb();
      seedUsers(db);
      const { service } = buildService(db);
      await expect(service.startConversation(USER_A, 'ghost')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('rejects a self-conversation (typing your own username)', async () => {
      const db = new FakeDb();
      seedUsers(db);
      const { service } = buildService(db);
      await expect(service.startConversation(USER_A, 'alpha')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('is username case-insensitive', async () => {
      const db = new FakeDb();
      seedUsers(db);
      const { service } = buildService(db);
      const result = await service.startConversation(USER_A, 'BETA');
      expect(result.otherUser.id).toBe(USER_B);
      expect(result.created).toBe(true);
    });

    it('returns created:false when the conversation already exists (no duplicate)', async () => {
      const db = new FakeDb();
      seedUsers(db);
      db.conversations.push({
        id: 'conv-existing',
        userAId: USER_A,
        userBId: USER_C,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const { service } = buildService(db);
      const result = await service.startConversation(USER_A, 'gamma');
      expect(result.created).toBe(false);
      expect(result.id).toBe('conv-existing');
      expect(db.conversations).toHaveLength(1);
    });

    it('recovers from a pair-race via re-read (unique violation)', async () => {
      const db = new FakeDb();
      seedUsers(db);
      db.conversations.push({
        id: 'conv-raced',
        userAId: USER_A,
        userBId: USER_B,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // save() throws once AFTER the stock seed row already exists → the
      // service must re-read and return created:false instead of throwing
      const { service } = buildService(db, { code: '23505' });
      const result = await service.startConversation(USER_A, 'beta');
      expect(result.created).toBe(false);
      expect(result.id).toBe('conv-raced');
    });
  });

  describe('sendMessage', () => {
    const seedConversation = (db: FakeDb): void => {
      db.conversations.push({
        id: 'conv-1',
        userAId: USER_A,
        userBId: USER_B,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    };

    it('persists the message and bumps the conversation activity stamp', async () => {
      const db = new FakeDb();
      const { service, gateway, db: _ } = buildService(db);
      seedUsers(db);
      seedConversation(db);

      const stampBefore = db.conversations[0].updatedAt.getTime();
      const { message, otherUserId } = await service.sendMessage(USER_A, 'conv-1', {
        content: ' Hello world  ',
      });
      expect(otherUserId).toBe(USER_B);
      expect(message.content).toBe('Hello world'); // trimmed
      expect(message.senderId).toBe(USER_A);
      expect(message.isRead).toBe(false);
      expect(db.messages).toHaveLength(1);

      // conversation stamp inside the SAME transaction (single qb update call)
      expect(db.conversations[0].updatedAt.getTime()).toBeGreaterThanOrEqual(stampBefore);
      // WS fan-out to BOTH participants happened exactly once
      expect(gateway.broadcastMessage).toHaveBeenCalledTimes(1);
      expect(gateway.broadcastMessage).toHaveBeenCalledWith(
        [USER_A, USER_B],
        expect.objectContaining({ conversationId: 'conv-1' }),
      );
      expect(gateway.broadcastConversationUpdated).toHaveBeenCalledTimes(1);
    });

    it('404s for a non-participant (isolation, no existence leak)', async () => {
      const db = new FakeDb();
      const { service } = buildService(db);
      seedUsers(db);
      seedConversation(db);
      await expect(
        service.sendMessage('stranger-user', 'conv-1', { content: 'hi' }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('listMessages + pagination', () => {
    it('returns newest-first pages with the envelope', async () => {
      const db = new FakeDb();
      const { service } = buildService(db);
      seedUsers(db);
      db.conversations.push({
        id: 'conv-1',
        userAId: USER_A,
        userBId: USER_B,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      for (let i = 0; i < 7; i++) {
        db.messages.push({
          id: `msg-${i}`,
          conversationId: 'conv-1',
          senderId: i % 2 ? USER_B : USER_A,
          content: `m${i}`,
          isRead: false,
          createdAt: futureDate(i),
        });
      }
      const page = await service.listMessages(USER_B, 'conv-1', { page: 2, limit: 3 });
      expect(page.total).toBe(7);
      expect(page.totalPages).toBe(3);
      expect(page.items).toHaveLength(3);
      expect(page.items.map((m) => m.id)).toEqual(['msg-3', 'msg-2', 'msg-1']); // newest first
      expect(page.otherUser.id).toBe(USER_A);
    });

    it('404s when a stranger reads the thread', async () => {
      const db = new FakeDb();
      const { service } = buildService(db);
      seedUsers(db);
      db.conversations.push({
        id: 'conv-1',
        userAId: USER_A,
        userBId: USER_B,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(
        service.listMessages('stranger-user', 'conv-1', { limit: 5 } as never),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('markRead', () => {
    it('flips only the OTHER user’s unread messages and fans a read event', async () => {
      const db = new FakeDb();
      const { service, gateway } = buildService(db);
      seedUsers(db);
      db.conversations.push({
        id: 'conv-1',
        userAId: USER_A,
        userBId: USER_B,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      db.messages.push(
        { id: 'm1', conversationId: 'conv-1', senderId: USER_B, content: 'a', isRead: false, createdAt: futureDate(1) },
        { id: 'm2', conversationId: 'conv-1', senderId: USER_B, content: 'b', isRead: false, createdAt: futureDate(2) },
        { id: 'm3', conversationId: 'conv-1', senderId: USER_A, content: 'own', isRead: false, createdAt: futureDate(3) }, // own → untouched
      );

      const result = await service.markRead(USER_A, 'conv-1');
      expect(result.markedRead).toBe(2); // own message (m3) stays unread
      expect(db.messages.find((m) => m.id === 'm1')?.isRead).toBe(true);
      expect(db.messages.find((m) => m.id === 'm3')?.isRead).toBe(false);
      expect(gateway.broadcastRead).toHaveBeenCalledWith([USER_A, USER_B], {
        conversationId: 'conv-1',
        readByUserId: USER_A,
        markedRead: 2,
      });
    });
  });
});
