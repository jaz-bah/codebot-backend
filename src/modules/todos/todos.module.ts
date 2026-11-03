import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { TodosController } from './todos.controller';
import { TodosService, TODO_DATA_SOURCE } from './todos.service';

/**
 * User todo CRUD + pagination/search/sort/manual reorder.
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls; ownership scoping is enforced by
 * TodosService (user_id on EVERY query — PRD D2 plain-string reference).
 */
@Module({
  controllers: [TodosController],
  providers: [
    TodosService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as audit).
      provide: TODO_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class TodosModule {}
