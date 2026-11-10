import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { ArtboardsController } from './artboards.controller';
import { ArtboardsService, ARTBOARD_DATA_SOURCE } from './artboards.service';

/**
 * User artboard CRUD + pagination/search/sort.
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls; ownership scoping is enforced by
 * ArtboardsService (user_id on EVERY query — PRD D2 plain-string reference).
 */
@Module({
  controllers: [ArtboardsController],
  providers: [
    ArtboardsService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: ARTBOARD_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class ArtboardsModule {}
