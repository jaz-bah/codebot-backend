import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { SettingsController } from './settings.controller';
import { SettingsService, SETTINGS_DATA_SOURCE } from './settings.service';

/**
 * Per-user credentials/settings (OpenRouter key, Cloudinary creds).
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls. Secrets are AES-256-GCM
 * encrypted at rest (settings-cipher.ts) and never returned by the API.
 */
@Module({
  controllers: [SettingsController],
  providers: [
    SettingsService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: SETTINGS_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
  // SettingsService is consumed by other modules (e.g. Uploads decrypts the
  // Cloudinary credentials server-side).
  exports: [SettingsService],
})
export class SettingsModule {}
