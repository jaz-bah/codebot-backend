import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { SettingsModule } from '../settings/settings.module';
import { CloudinaryClient } from '../uploads/cloudinary-client';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DOCUMENTS_DATA_SOURCE } from './documents.tokens';

/**
 * Document Management System: uploaded files with per-file metadata (name,
 * description, Cloudinary url). Bytes go to the user's own Cloudinary
 * account (credentials from the Settings module); metadata lives in the
 * TypeORM `document` table.
 *
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls; ownership scoping is enforced
 * by DocumentsService (user_id on EVERY query).
 */
@Module({
  imports: [SettingsModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    CloudinaryClient,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: DOCUMENTS_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class DocumentsModule {}
