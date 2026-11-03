import {
  Body,
  Controller,
  Delete,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PostsService, PostPage, PostView, VoteResult } from './posts.service';
import { createPostSchema, CreatePostDto } from './dto/create-post.dto';
import { updatePostSchema, UpdatePostDto } from './dto/update-post.dto';
import { queryPostsSchema, QueryPostsDto } from './dto/query-posts.dto';

/**
 * PUBLIC post sharing surface. ONLY auth-required routes carry
 * AuthenticatedGuard — the feed/detail endpoints stay reachable for
 * anonymous visitors; BetterAuthSessionGuard (global APP_GUARD) still
 * attaches `authUser` for signed-in viewers so their `hasVoted` state is
 * included. Ownership (create/edit/delete/vote management) is enforced by
 * PostsService.
 *
 * Route ordering matters: param-less routes (`me`) are declared before the
 * `:id` routes so Nest matches them first.
 */
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  /** Public feed — anonymous allowed; signed-in viewers get hasVoted. */
  @Get()
  feed(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query(new JoiValidationPipe(queryPostsSchema)) query: QueryPostsDto,
  ): Promise<PostPage> {
    return this.posts.feed(query ?? ({} as QueryPostsDto), user?.id ?? null);
  }

  /** Own posts — same filters/sorts as the public feed, scoped to the author. */
  @Get('me')
  @UseGuards(AuthenticatedGuard)
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryPostsSchema)) query: QueryPostsDto,
  ): Promise<PostPage> {
    return this.posts.mine(user.id, query ?? ({} as QueryPostsDto));
  }

  /** Single post detail — public; hasVoted reflects the (optional) viewer. */
  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PostView> {
    return this.posts.findOne(id, user?.id ?? null);
  }

  /** Publish an owned resource as a public post. */
  @Post()
  @UseGuards(AuthenticatedGuard)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(createPostSchema)) dto: CreatePostDto,
  ): Promise<PostView> {
    return this.posts.create(user.id, dto);
  }

  /** Edit own post's presentation metadata (title/description). */
  @Patch(':id')
  @UseGuards(AuthenticatedGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new JoiValidationPipe(updatePostSchema)) dto: UpdatePostDto,
  ): Promise<PostView> {
    return this.posts.update(user.id, id, dto);
  }

  /** Un-publish own post (its votes cascade away with it). */
  @Delete(':id')
  @UseGuards(AuthenticatedGuard)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean; id: string }> {
    return this.posts.remove(user.id, id);
  }

  /** Upvote a post once — second vote returns 409 (one vote per user). */
  @Post(':id/vote')
  @HttpCode(201)
  @UseGuards(AuthenticatedGuard)
  vote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VoteResult> {
    return this.posts.addVote(user.id, id);
  }

  /** Withdraw the caller's vote (never-cast vote → 404). */
  @Delete(':id/vote')
  @UseGuards(AuthenticatedGuard)
  unvote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VoteResult> {
    return this.posts.removeVote(user.id, id);
  }
}
