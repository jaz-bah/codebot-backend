import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { IdeSnippetsController } from './ide-snippets.controller';
import { IdeSnippetsService, IDE_SNIPPETS_DATA_SOURCE } from './ide-snippets.service';

/**
 * User IDE snippet CRUD + pagination/search/language filter/sort.
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls; ownership scoping is enforced by
 * IdeSnippetsService (user_id on EVERY query — PRD D2 plain-string reference).
 */
@Module({
  controllers: [IdeSnippetsController],
  providers: [
    IdeSnippetsService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: IDE_SNIPPETS_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class IdeSnippetsModule {}
