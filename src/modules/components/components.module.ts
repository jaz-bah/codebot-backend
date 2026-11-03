import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { ComponentsController } from './components.controller';
import { ComponentsService } from './components.service';
import { COMPONENTS_DATA_SOURCE } from './components.tokens';

/**
 * Component Management System: user-owned UI components — a name, a preview
 * image reference and N code files (component/component_file tables).
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls; ownership scoping is enforced
 * by ComponentsService (user_id on EVERY query).
 */
@Module({
  controllers: [ComponentsController],
  providers: [
    ComponentsService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: COMPONENTS_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class ComponentsModule {}
