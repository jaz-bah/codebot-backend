import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { CloudinaryClient } from './cloudinary-client';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * File uploads (images, zips) to the user's own Cloudinary account using the
 * credentials stored in the Settings module (AES-256-GCM encrypted at rest,
 * decrypted only inside the server for this upload call).
 *
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls.
 */
@Module({
  imports: [SettingsModule],
  controllers: [UploadsController],
  providers: [UploadsService, CloudinaryClient],
  exports: [UploadsService, CloudinaryClient],
})
export class UploadsModule {}
