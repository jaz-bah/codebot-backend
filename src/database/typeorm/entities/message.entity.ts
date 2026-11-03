import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * DOMAIN table: chat message (TypeORM-owned, PRD D2). Belongs to a
 * `conversation` (FK ON DELETE CASCADE — created by the migration); the sender
 * references BetterAuth users via a PLAIN string `sender_id` — never a FK.
 *
 * Read status: `is_read` becomes true (with `read_at`) when the OTHER
 * participant opens the conversation — the sender's own reads never touch the
 * flag. Messages are immutable content-wise (no edit/delete endpoints).
 */
@Entity('message')
@Index('idx_message_conversation_created', ['conversationId', 'createdAt'])
@Index('idx_message_conversation_unread', ['conversationId', 'isRead'], {
  where: '"is_read" = false',
})
@Index('idx_message_sender', ['senderId'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Conversation the message was sent into (FK, cascade-deleted with it). */
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  /** BetterAuth user id of the sender (plain string, no FK — PRD D2). */
  @Column({ name: 'sender_id', type: 'text' })
  senderId!: string;

  @Column({ type: 'text' })
  content!: string;

  /** True once the recipient opened the conversation after this message. */
  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead!: boolean;

  /** When the recipient read it (null until then). */
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
