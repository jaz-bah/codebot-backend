import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { POSTS_DATA_SOURCE } from './posts.tokens';

/**
 * Public post sharing over existing resources.
 * Only the WRITE routes are guarded (AuthenticatedGuard per-method); the feed
 * and detail routes stay PUBLIC (BetterAuthSessionGuard still resolves the
 * session for signed-in viewers). Ownership + one-vote-per-user are enforced
 * by PostsService (user_id in every query, composite pk on post_vote).
 *
 * TypeORM domain tables share the single AppDataSource (same instance as
 * todos/chat).
 */
@Module({
  controllers: [PostsController],
  providers: [
    PostsService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: POSTS_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class PostsModule {}
