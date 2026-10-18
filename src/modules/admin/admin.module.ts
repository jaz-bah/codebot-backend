import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService, ADMIN_DB } from './admin.service';
import { AuditService } from './audit.service';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { APP_CONFIG } from '../../config/app-config.token';
import { AppConfig } from '../../config/configuration';
import { getAuthKysely } from '../../database/kysely/auth-db';

/**
 * Admin endpoints + audit. AdminGuard is applied at controller level because
 * it needs Reflector + AuditService; the session guard is global (APP_GUARD).
 * US-6 boot promotion also lives here (AdminBootstrapService).
 */
@Module({
  controllers: [AdminController],
  providers: [
    AuditService,
    AdminService,
    AdminBootstrapService,
    {
      provide: ADMIN_DB,
      useFactory: (appConfig: AppConfig) => getAuthKysely(appConfig.databaseUrl),
      inject: [APP_CONFIG],
    },
  ],
  exports: [AuditService],
})
export class AdminModule {}
