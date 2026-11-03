import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { PresetsController } from './presets.controller';
import { PresetsService, PRESETS_DATA_SOURCE } from './presets.service';

/**
 * User preset CRUD + pagination/search/language filter/sort.
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls; ownership scoping is enforced by
 * PresetsService (user_id on EVERY query — PRD D2 plain-string reference).
 */
@Module({
  controllers: [PresetsController],
  providers: [
    PresetsService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: PRESETS_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class PresetsModule {}
