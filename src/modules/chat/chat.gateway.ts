import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WS_SESSION_VERIFIER } from '../auth/auth.module';
import type { SocketSession } from '../auth/socket-session';
/**
 * Real-time chat channel (Socket.IO), mounted on the SAME HTTP server Nest
 * already owns — no second process/port.
 *
 * - Authentication happens per CONNECTION: the handshake's session cookie is
 *   verified against BetterAuth offline (HMAC + session-table lookup — see
 *   WS_SESSION_VERIFIER). Anonymous sockets are disconnected.
 * - The auth attempt is STARTED synchronously in `handleConnection` and stored
 *   as a Promise, so every message handler can `await` it and never sees the
 *   "not yet authenticated" race (a client event can legally arrive before the
 *   async DB roundtrip finishes).
 * - Presence model: one room per USER (`user:{id}`) — every socket of a user
 *   sits in it. Conversation events are broadcast to BOTH participants, so
 *   message/read/list refreshes fan out to every device of both sides without
 *   any client-side bookkeeping.
 * - The gateway NEVER touches the domain database: it only fans out events on
 *   behalf of ChatService (all persistence + authorization live there).
 */
const USER_ROOM = (userId: string): string => `user:${userId}`;

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: (process.env.CORS_ORIGIN_URLS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server: Server | undefined;

  private readonly logger = new Logger(ChatGateway.name);

  /** socket.id → BetterAuth session identity of the connection (pending). */
  private readonly sessionBySocket = new Map<string, Promise<SocketSession | null>>();

  constructor(
    @Inject(WS_SESSION_VERIFIER)
    private readonly verifySession: (cookie: string | undefined | null) => Promise<SocketSession | null>,
  ) {}

  handleConnection(client: Socket): void {
    const handshake = client.handshake as { headers?: Record<string, unknown> };
    // Started SYNCHRONOUSLY so the map entry exists before any handler runs —
    // verifying/expiring never blocks message delivery order either, because
    // handlers simply await this same promise.
    const authenticity = this.verifySession(
      typeof handshake.headers?.cookie === 'string' ? handshake.headers.cookie : undefined,
    );
    this.sessionBySocket.set(client.id, authenticity);
    void authenticity
      .then(async (session) => {
        if (!session) throw new Error('no valid session cookie');
        await client.join(USER_ROOM(session.userId));
        this.logger.log(`socket connected: user=${session.userId} socket=${client.id}`);
      })
      .catch(() => {
        this.sessionBySocket.delete(client.id);
        this.logger.warn(`unauthenticated /chat connection rejected (${client.id})`);
        client.emit('unauthorized', { message: 'valid session cookie required' });
        client.disconnect(true);
      });
  }

  handleDisconnect(client: Socket): void {
    this.sessionBySocket.delete(client.id);
  }

  /** Awaits the connection's authenticity result (null when anonymous). */
  private authenticated(client: Socket): Promise<SocketSession | null> {
    return this.sessionBySocket.get(client.id) ?? Promise.resolve(null);
  }

  // ── fan-out (called by ChatService) ───────────────────────────────────────

  /**
   * A message was persisted — deliver it to BOTH participants' devices (the
   * sender's other tabs included; the initiating HTTP caller gets the 201 and
   * can de-duplicate by message id).
   */
  broadcastMessage(userIds: [string, string], payload: {
    conversationId: string;
    message: { id: string; content: string; senderId: string; createdAt: string; isRead: boolean };
  }): void {
    if (!this.server) return;
    for (const userId of userIds) {
      this.server.to(USER_ROOM(userId)).emit('message:new', payload);
    }
  }

  /** New message happened in the thread → refresh the conversation list. */
  broadcastConversationUpdated(
    userIds: [string, string],
    payload: {
      conversationId: string;
      preview: {
        content: string;
        senderId: string;
        createdAt: string;
        isRead: boolean;
      } | null;
      updatedAt: string;
    },
  ): void {
    if (!this.server) return;
    for (const userId of userIds) {
      this.server.to(USER_ROOM(userId)).emit('conversation:updated', payload);
    }
  }

  /** The recipient read the thread → update sender-side read indicators. */
  broadcastRead(userIds: [string, string], payload: {
    conversationId: string;
    readByUserId: string;
    markedRead: number;
  }): void {
    if (!this.server) return;
    for (const userId of userIds) {
      if (userId === payload.readByUserId) continue; // reader knows already
      this.server.to(USER_ROOM(userId)).emit('messages:read', payload);
    }
  }

  /** Client-side keepalive/validation helper: who is this socket? */
  @SubscribeMessage('whoami')
  async whoami(@ConnectedSocket() client: Socket): Promise<{ userId: string }> {
    const session = await this.authenticated(client);
    return { userId: session?.userId ?? '' };
  }

  /**
   * `_ack` heartbeat — lets clients verify the socket still lives without
   * touching the DB (used by clients and struggle-prone mobile nets).
   * NOTE: the ack payload may NOT carry an `event` key — the socket.io adapter
   * treats `{event, data}` shapes as outgoing messages instead of acks.
   */
  @SubscribeMessage('ping')
  async pong(@ConnectedSocket() client: Socket): Promise<{ connectedAs: string }> {
    const session = await this.authenticated(client);
    return { connectedAs: session?.userId ?? '' };
  }
}
