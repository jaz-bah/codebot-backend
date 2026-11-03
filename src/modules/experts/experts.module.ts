import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { ExpertsController } from './experts.controller';
import { ExpertsService, EXPERTS_DATA_SOURCE } from './experts.service';

/**
 * User expert CRUD + pagination/search/sort.
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls; ownership scoping is enforced by
 * ExpertsService (user_id on EVERY query — PRD D2 plain-string reference).
 */
@Module({
  controllers: [ExpertsController],
  providers: [
    ExpertsService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: EXPERTS_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class ExpertsModule {}
