import { Module } from '@nestjs/common';
import { AppDataSource } from '../../database/typeorm/data-source';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { PROFILE_DATA_SOURCE } from './profile.tokens';

/**
 * User profiles: unique short nickname (auto-generated, lazily created) +
 * unique username handling + profile image (via the auth `user` row) + live
 * counts over every domain table. Guard chain: BetterAuthSessionGuard
 * (global) attaches authUser → AuthenticatedGuard rejects anonymous calls;
 * counts are computed per request pinned to the session user.
 */
@Module({
  // AuthModule is imported (not strictly required at runtime — the profile
  // service reaches the auth DB directly) so module composition documents
  // the dependency and BetterAuth is initialized before profile consumers.
  // UploadsModule provides the Cloudinary pipeline used by PATCH /profile/image.
  imports: [UploadsModule, AuthModule],
  controllers: [ProfileController],
  providers: [
    ProfileService,
    {
      // Shared TypeORM DataSource for DOMAIN tables (same instance as todos).
      provide: PROFILE_DATA_SOURCE,
      useValue: AppDataSource,
    },
  ],
})
export class ProfileModule {}
