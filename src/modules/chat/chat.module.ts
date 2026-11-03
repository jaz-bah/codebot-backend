import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { AuthModule } from '../auth/auth.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { CHAT_DATA_SOURCE, CHAT_GATEWAY } from './chat.tokens';

/**
 * 1:1 chat (conversations/messages + REST history + Socket.IO fan-out).
 * Guard chain: BetterAuthSessionGuard (global APP_GUARD) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls; conversation membership is
 * enforced by ChatService (non-participants get 404, never 403).
 *
 * The Socket.IO gateway mounts its own namespace-auth (session cookie on the
 * handshake, verified offline via WS_SESSION_VERIFIER). AuthModule is imported
 * for that token; TypeORM domain tables share the single AppDataSource.
 */
@Module({
  imports: [AuthModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatGateway,
    { provide: CHAT_GATEWAY, useExisting: ChatGateway },
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: CHAT_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class ChatModule {}
