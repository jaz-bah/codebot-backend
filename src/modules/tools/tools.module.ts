import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { ToolsController } from './tools.controller';
import { ToolsService, TOOL_DATA_SOURCE } from './tools.service';

/**
 * User tool CRUD + pagination/search/sort.
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls; ownership scoping is enforced by
 * ToolsService (user_id on EVERY query — PRD D2 plain-string reference).
 */
@Module({
  controllers: [ToolsController],
  providers: [
    ToolsService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: TOOL_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class ToolsModule {}
