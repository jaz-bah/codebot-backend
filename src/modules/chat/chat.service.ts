import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Conversation } from '../../database/typeorm/entities/conversation.entity';
import { Message } from '../../database/typeorm/entities/message.entity';
import { CHAT_DATA_SOURCE, CHAT_GATEWAY } from './chat.tokens';
import { SEARCH_USERS_DEFAULT_LIMIT } from './dto/search-users.dto';
import type { SearchUsersDto } from './dto/search-users.dto';
import type { SendMessageDto } from './dto/send-message.dto';
import type { QueryChatDto } from './dto/query-chat.dto';
import type { ChatGateway } from './chat.gateway';

export interface ChatUser {
  id: string;
  username: string;
  name: string;
  image: string | null;
  /** Conversation id when the caller already chats with this user, else null. */
  conversationId: string | null;
}

export interface ConversationUser {
  id: string;
  username: string;
  name: string;
  image: string | null;
}

export interface LastMessagePreview {
  id: string;
  content: string;
  senderId: string;
  createdAt: Date;
  isRead: boolean;
}

export interface ConversationView {
  id: string;
  otherUser: ConversationUser;
  lastMessage: LastMessagePreview | null;
  /** Messages sent by the OTHER user that the caller has not read yet. */
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StartConversationResult extends ConversationView {
  /** false when the conversation already existed (get, not create). */
  created: boolean;
}

export interface ChatMessageView {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export interface MessagePage {
  items: ChatMessageView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface MessageEnvelope extends MessagePage {
  otherUser: ConversationUser;
}

export interface ConversationPage {
  items: ConversationView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReadResult {
  conversationId: string;
  /** Messages flipped to read in this call. */
  markedRead: number;
  /** The reader (caller) — used to route the WS read event. */
  readByUserId: string;
}

const SEARCH_USERS_MAX_LIMIT = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const clampPagination = (page?: number, limit?: number): { page: number; limit: number } => {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  return { page: safePage, limit: safeLimit };
};

/** Escape LIKE wildcards in user input so `100%` does not match everything. */
const escapeLike = (input: string): string => input.replace(/([%_\\])/g, '\\$1');

/** pg error code for a unique-index violation (the uq_conversation_pair race). */
const PG_UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION;

interface ConversationRow {
  id: string;
  created_at: Date;
  updated_at: Date;
  other_id: string;
  other_username: string | null;
  other_name: string;
  other_image: string | null;
  unread_count: number | string;
  last_id: string | null;
  last_content: string | null;
  last_sender_id: string | null;
  last_created_at: Date | null;
  last_is_read: boolean | null;
}

interface UserRow {
  id: string;
  username: string | null;
  name: string;
  image: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  read_at: Date | null;
  created_at: Date;
}

const toUser = (row: UserRow): ConversationUser => ({
  id: row.id,
  username: row.username ?? '',
  name: row.name,
  image: row.image,
});

const toMessageView = (row: MessageRow): ChatMessageView => ({
  id: row.id,
  conversationId: row.conversation_id,
  senderId: row.sender_id,
  content: row.content,
  isRead: row.is_read,
  readAt: row.read_at,
  createdAt: row.created_at,
});

const toConversationView = (row: ConversationRow): ConversationView => ({
  id: row.id,
  otherUser: {
    id: row.other_id,
    username: row.other_username ?? '',
    name: row.other_name,
    image: row.other_image,
  },
  lastMessage: row.last_id
    ? {
        id: row.last_id,
        content: row.last_content ?? '',
        senderId: row.last_sender_id ?? '',
        createdAt: row.last_created_at ?? row.updated_at,
        isRead: row.last_is_read ?? false,
      }
    : null,
  unreadCount: Number(row.unread_count ?? 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const SEARCH_BASE = [
  'SELECT u.id, u.username, u.name, u.image, c.id AS "conversationId"',
  'FROM "user" u',
  'LEFT JOIN "conversation" c',
  '  ON (c."user_a_id" = $1 AND c."user_b_id" = u.id)',
  '  OR (c."user_b_id" = $1 AND c."user_a_id" = u.id)',
  'WHERE u.id <> $1 AND u.username IS NOT NULL',
].join('\n');

/**
 * 1:1 chat over BetterAuth ids (plain strings, no FK — PRD D2). Every
 * conversation query is scoped by the caller's id; the canonical
 * (user_a_id, user_b_id) UNIQUE pair index makes duplicate conversations
 * impossible, and message writes run inside ONE transaction together with
 * the conversation's `updated_at` activity bump.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(CHAT_DATA_SOURCE) private readonly dataSource: DataSource,
    @Inject(CHAT_GATEWAY) private readonly gateway: ChatGateway,
  ) {}

  private async ready(): Promise<DataSource> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
    return this.dataSource;
  }

  // ── PEOPLE SEARCH (username) ───────────────────────────────────────────────

  /**
   * Substring search over `user.username` (plugin stores it lowercase so the
   * match behavior is case-insensitive). Callers are excluded, users without
   * a username are invisible until they pick one. One round-trip also resolves
   * whether a conversation with the caller already exists so the client can
   * open an existing thread straight away.
   */
  async searchUsers(userId: string, query: SearchUsersDto): Promise<ChatUser[]> {
    const ds = await this.ready();
    const limit = Math.min(
      Math.max(Number(query.limit) || SEARCH_USERS_DEFAULT_LIMIT, 1),
      SEARCH_USERS_MAX_LIMIT,
    );

    const values: unknown[] = [userId, limit];
    const sql = query.q
      ? `${SEARCH_BASE}\nAND u.username LIKE $3\nORDER BY u.username ASC\nLIMIT $2`
      : `${SEARCH_BASE}\nORDER BY u.username ASC\nLIMIT $2`;
    if (query.q) values.push(`%${escapeLike(query.q.toLowerCase())}%`);

    const rows = (await ds.query(sql, values)) as Array<{
      id: string;
      username: string;
      name: string;
      image: string | null;
      conversationId: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      name: r.name,
      image: r.image,
      conversationId: r.conversationId ?? null,
    }));
  }

  // ── START / OPEN A CONVERSATION (username → get-or-create) ─────────────────

  /**
   * Resolve the target by username, then get-or-create the conversation.
   * Duplicates can never appear: the canonical pair (sorted ids) is protected
   * by uq_conversation_pair, and a concurrent start re-reads the winner row
   * instead of failing.
   */
  async startConversation(userId: string, username: string): Promise<StartConversationResult> {
    const ds = await this.ready();
    const rows = (await ds.query(
      `SELECT id, username, name, image FROM "user" WHERE lower(username) = lower($1) LIMIT 1`,
      [username.trim()],
    )) as UserRow[];
    const target = rows[0];
    if (!target) throw new NotFoundException(`No user with username "${username}"`);
    if (target.id === userId) {
      throw new BadRequestException('You cannot start a conversation with yourself');
    }

    const [userAId, userBId] = [userId, target.id].sort();
    const otherUser = toUser(target);

    return ds.transaction(async (em) => {
      const repo = em.getRepository(Conversation);
      const existing = (await repo.findOne({ where: { userAId, userBId } as never })) as
        | Conversation
        | undefined;
      if (existing) {
        return { conversation: existing, created: false as const };
      }
      try {
        const created = (await repo.save(
          repo.create({ userAId, userBId } as never) as unknown as Conversation,
        )) as Conversation;
        return { conversation: created, created: true as const };
      } catch (error) {
        // Concurrent start with the same partner → the UNIQUE index fired;
        // read the winning row and treat it as the existing conversation.
        if (!isUniqueViolation(error)) throw error;
        const raced = (await repo.findOne({ where: { userAId, userBId } as never })) as
          | Conversation
          | undefined;
        if (!raced) {
          throw new BadRequestException('could not open the conversation, try again');
        }
        return { conversation: raced, created: false as const };
      }
    }).then(({ conversation, created }) => ({
      id: conversation.id,
      otherUser,
      lastMessage: null,
      unreadCount: 0,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      created,
    }));
  }

  // ── CONVERSATION LIST ──────────────────────────────────────────────────────

  /**
   * Every conversation the caller participates in, most-recent-activity first.
   * ONE SQL round-trip per page: the other participant, the newest message
   * (lateral join) and the unread count (scalar subselect) ride along.
   */
  async listConversations(userId: string, query: QueryChatDto): Promise<ConversationPage> {
    const { page, limit } = clampPagination(query?.page, query?.limit);
    const ds = await this.ready();

    const memberClause = `c."user_a_id" = $1 OR c."user_b_id" = $1`;
    const listSql = [
      'SELECT c.id, c."user_a_id", c."user_b_id", c."created_at", c."updated_at",',
      '  ou.id AS other_id, ou.username AS other_username, ou.name AS other_name, ou.image AS other_image,',
      '  (SELECT count(*)::int FROM "message" m',
      '    WHERE m."conversation_id" = c.id AND m."sender_id" <> $1 AND m."is_read" = false) AS unread_count,',
      '  lm.id AS last_id, lm.content AS last_content, lm."sender_id" AS last_sender_id,',
      '  lm."created_at" AS last_created_at, lm."is_read" AS last_is_read',
      'FROM "conversation" c',
      'JOIN "user" ou ON ou.id = (CASE WHEN c."user_a_id" = $1 THEN c."user_b_id" ELSE c."user_a_id" END)',
      'LEFT JOIN LATERAL (',
      '  SELECT m.* FROM "message" m WHERE m."conversation_id" = c.id',
      '  ORDER BY m."created_at" DESC LIMIT 1',
      ') lm ON true',
      `WHERE ${memberClause}`,
    ].join('\n');

    const [countRows, rows] = await Promise.all([
      ds.query(`SELECT count(*)::int AS cnt FROM "conversation" c WHERE ${memberClause}`, [userId]),
      ds.query(`${listSql}\nORDER BY c."updated_at" DESC\nLIMIT $2 OFFSET $3`, [
        userId,
        limit,
        (page - 1) * limit,
      ]),
    ]);

    const total = Number((countRows as Array<{ cnt: number }>)[0]?.cnt ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      items: (rows as ConversationRow[]).map(toConversationView),
      total,
      page,
      limit,
      totalPages,
    };
  }

  // ── MEMBERSHIP ─────────────────────────────────────────────────────────────

  /** Throw 404 unless the conversation exists AND the caller is in the pair. */
  private async assertMembership(
    userId: string,
    conversationId: string,
  ): Promise<{ otherUserId: string }> {
    const ds = await this.ready();
    const rows = (await ds.query(
      `SELECT c."user_a_id", c."user_b_id" FROM "conversation" c WHERE c.id = $1 LIMIT 1`,
      [conversationId],
    )) as Array<{ user_a_id: string; user_b_id: string }>;
    const row = rows[0];
    if (
      !row ||
      (row.user_a_id !== userId && row.user_b_id !== userId)
    ) {
      // 404, not 403 — never confirm a thread exists to a non-participant.
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }
    return { otherUserId: row.user_a_id === userId ? row.user_b_id : row.user_a_id };
  }

  /** A single conversation view (same shape the list uses, no pagination). */
  async getConversation(userId: string, conversationId: string): Promise<ConversationView> {
    const { otherUserId } = await this.assertMembership(userId, conversationId);
    const [otherUser, unreadCount] = await Promise.all([
      this.requireUser(otherUserId),
      this.unreadCount(userId, conversationId),
    ]);
    const ds = await this.ready();
    const rows = (await ds.query(
      `SELECT id, "created_at", "updated_at" FROM "conversation" WHERE id = $1 LIMIT 1`,
      [conversationId],
    )) as Array<{ id: string; created_at: Date; updated_at: Date }>;
    const conversation = rows[0];
    if (!conversation) throw new NotFoundException(`Conversation ${conversationId} not found`);

    const lastRows = (await ds.query(
      `SELECT id, content, "sender_id", "created_at", "is_read" FROM "message"
       WHERE "conversation_id" = $1 ORDER BY "created_at" DESC LIMIT 1`,
      [conversationId],
    )) as Array<{
      id: string;
      content: string;
      sender_id: string;
      created_at: Date;
      is_read: boolean;
    }>;
    const last = lastRows[0];

    return {
      id: conversation.id,
      otherUser,
      unreadCount,
      lastMessage: last
        ? {
            id: last.id,
            content: last.content,
            senderId: last.sender_id,
            createdAt: last.created_at,
            isRead: last.is_read,
          }
        : null,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
    };
  }

  private unreadCount(recipientId: string, conversationId: string): Promise<number> {
    return this.ready().then(async (ds) => {
      const rows = (await ds.query(
        `SELECT count(*)::int AS cnt FROM "message"
         WHERE "conversation_id" = $1 AND "sender_id" <> $2 AND "is_read" = false`,
        [conversationId, recipientId],
      )) as Array<{ cnt: number }>;
      return Number(rows[0]?.cnt ?? 0);
    });
  }

  private async requireUser(userId: string): Promise<ConversationUser> {
    const ds = await this.ready();
    const rows = (await ds.query(
      `SELECT id, username, name, image FROM "user" WHERE id = $1 LIMIT 1`,
      [userId],
    )) as UserRow[];
    if (!rows[0]) throw new NotFoundException('User not found');
    return toUser(rows[0]);
  }

  // ── MESSAGES ───────────────────────────────────────────────────────────────

  /** Paginated history, newest first, with the other participant echoed. */
  async listMessages(
    userId: string,
    conversationId: string,
    query: QueryChatDto,
  ): Promise<MessageEnvelope> {
    const { page, limit } = clampPagination(query?.page, query?.limit);
    const { otherUserId } = await this.assertMembership(userId, conversationId);
    const ds = await this.ready();

    const [totalRows, messageRows, otherUser] = await Promise.all([
      ds.query(`SELECT count(*)::int AS cnt FROM "message" WHERE "conversation_id" = $1`, [
        conversationId,
      ]),
      ds.query(
        `SELECT id, "conversation_id", "sender_id", content, "is_read", "read_at", "created_at"
         FROM "message"
         WHERE "conversation_id" = $1
         ORDER BY "created_at" DESC
         LIMIT $2 OFFSET $3`,
        [conversationId, limit, (page - 1) * limit],
      ),
      this.requireUser(otherUserId),
    ]);

    const total = Number((totalRows as Array<{ cnt: number }>)[0]?.cnt ?? 0);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      items: (messageRows as MessageRow[]).map(toMessageView),
      total,
      page,
      limit,
      totalPages,
      otherUser,
    };
  }

  /**
   * Send: insert the message + bump the conversation's activity stamp inside
   * ONE transaction (the conversation must exist and include the sender).
   */
  async sendMessage(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): Promise<{ message: ChatMessageView; otherUserId: string }> {
    const { otherUserId } = await this.assertMembership(userId, conversationId);
    const ds = await this.ready();

    const saved = await ds.transaction(async (em) => {
      const repo = em.getRepository(Message);
      const message = repo.create({
        conversationId,
        senderId: userId,
        content: dto.content.trim(),
        isRead: false,
        readAt: null,
      } as never) as unknown as Message;
      const persisted = (await repo.save(message)) as Message;

      await em
        .getRepository(Conversation)
        .createQueryBuilder('c')
        .update(Conversation)
        .set({ updatedAt: () => 'now()' })
        .where('id = :id', { id: conversationId })
        .execute();

      return persisted;
    });

    // Fan-out AFTER the transaction commits — the events describe durable state.
    this.gateway.broadcastMessage([userId, otherUserId], {
      conversationId,
      message: {
        id: saved.id,
        content: saved.content,
        senderId: saved.senderId,
        createdAt: saved.createdAt.toISOString(),
        isRead: saved.isRead,
      },
    });
    this.gateway.broadcastConversationUpdated([userId, otherUserId], {
      conversationId,
      preview: {
        content: saved.content,
        senderId: saved.senderId,
        createdAt: saved.createdAt.toISOString(),
        isRead: saved.isRead,
      },
      updatedAt: new Date().toISOString(),
    });

    return {
      message: {
        id: saved.id,
        conversationId: saved.conversationId,
        senderId: saved.senderId,
        content: saved.content,
        isRead: saved.isRead,
        readAt: saved.readAt,
        createdAt: saved.createdAt,
      },
      otherUserId,
    };
  }

  /**
   * Read receipt: flip every UNREAD message from the OTHER user. The caller's
   * own messages are never touched (their read state means "recipient saw it").
   */
  async markRead(userId: string, conversationId: string): Promise<ReadResult> {
    const { otherUserId } = await this.assertMembership(userId, conversationId);
    const ds = await this.ready();

    const markedRead = await ds.transaction(async (em) => {
      const result = await em
        .getRepository(Message)
        .createQueryBuilder('m')
        .update(Message)
        .set({ isRead: true, readAt: () => 'now()' })
        .where('"conversation_id" = :id AND "sender_id" <> :userId AND "is_read" = false', {
          id: conversationId,
          userId,
        })
        .execute();
      return result.affected ?? 0;
    });

    this.gateway.broadcastRead([userId, otherUserId], {
      conversationId,
      readByUserId: userId,
      markedRead,
    });

    return { conversationId, markedRead, readByUserId: userId };
  }
}
