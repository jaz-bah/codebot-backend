import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SEARCH_DATA_SOURCE } from './search.tokens';

/**
 * Unified scoped search across the user's domain tables (todos, notes,
 * workspace files, documents, components, presets, experts, tools, IDE
 * snippets). Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls; ownership scoping is enforced
 * by SearchService (user_id on EVERY per-scope query).
 */
@Module({
  controllers: [SearchController],
  providers: [
    SearchService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: SEARCH_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class SearchModule {}
