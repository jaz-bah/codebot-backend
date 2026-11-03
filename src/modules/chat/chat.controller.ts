import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedGuard } from '../../common/guards/authenticated.guard';
import { JoiValidationPipe } from '../../common/pipes/joi-validation.pipe';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  ConversationPage,
  ConversationView,
  MessageEnvelope,
  ReadResult,
  StartConversationResult,
  ChatUser,
} from './chat.service';
import { ChatService } from './chat.service';
import { searchUsersSchema, SearchUsersDto } from './dto/search-users.dto';
import { startConversationSchema, StartConversationDto } from './dto/start-conversation.dto';
import { sendMessageSchema, SendMessageDto } from './dto/send-message.dto';
import { queryChatSchema, QueryChatDto } from './dto/query-chat.dto';

/**
 * 1:1 chat surface. Guard chain: BetterAuthSessionGuard (global) attaches
 * authUser → AuthenticatedGuard rejects anonymous calls; conversation
 * membership is enforced by ChatService (404 for non-participants).
 *
 * Route ordering matters: param-less routes (`users`, `conversations`) are
 * declared before any `:id` route so Nest matches them first.
 */
@Controller('chat')
@UseGuards(AuthenticatedGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** People search by unique username → jump targets for existing threads. */
  @Get('users')
  searchUsers(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(searchUsersSchema)) query: SearchUsersDto,
  ): Promise<ChatUser[]> {
    return this.chat.searchUsers(user.id, query ?? ({} as SearchUsersDto));
  }

  /** Start a NEW conversation (or get the existing one) by username. */
  @Post('conversations')
  startConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(startConversationSchema)) dto: StartConversationDto,
  ): Promise<StartConversationResult> {
    return this.chat.startConversation(user.id, dto.username);
  }

  /** Conversation list (other user + last message + unread count). */
  @Get('conversations')
  listConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryChatSchema)) query: QueryChatDto,
  ): Promise<ConversationPage> {
    return this.chat.listConversations(user.id, query ?? ({} as QueryChatDto));
  }

  /** A single conversation (same view the list uses, without pagination). */
  @Get('conversations/:id')
  getConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationView> {
    return this.chat.getConversation(user.id, id);
  }

  /** Paginated message history, newest first. */
  @Get('conversations/:id/messages')
  listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new JoiValidationPipe(queryChatSchema)) query: QueryChatDto,
  ): Promise<MessageEnvelope> {
    return this.chat.listMessages(user.id, id, query ?? ({} as QueryChatDto));
  }

  /** Send a text message into the thread (persisted transactionally). */
  @Post('conversations/:id/messages')
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new JoiValidationPipe(sendMessageSchema)) dto: SendMessageDto,
  ): Promise<{ message: unknown }> {
    return this.chat.sendMessage(user.id, id, dto);
  }

  /** Read receipt: mark every unread incoming message as read. */
  @Patch('conversations/:id/read')
  @HttpCode(200)
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReadResult> {
    return this.chat.markRead(user.id, id);
  }
}
