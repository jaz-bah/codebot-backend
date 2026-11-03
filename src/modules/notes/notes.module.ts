import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { FilesController } from './files.controller';
import { NotesController } from './notes.controller';
import { FilesService } from './files.service';
import { NotesService } from './notes.service';
import { NOTES_DATA_SOURCE } from './notes.tokens';

/**
 * Note Management System: workspace file tree (folders + HTML note files) and
 * rich-HTML note content. Guard chain: BetterAuthSessionGuard (global) attaches
 * authUser → AuthenticatedGuard rejects anonymous calls; ownership scoping is
 * enforced by the services (user_id on EVERY query — PRD D2 plain-string ref).
 */
@Module({
  controllers: [FilesController, NotesController],
  providers: [
    FilesService,
    NotesService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: NOTES_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class NotesModule {}
