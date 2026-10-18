import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { APP_CONFIG } from '../../config/app-config.token';
import { AppConfig } from '../../config/configuration';
import { getAuthKysely } from '../../database/kysely/auth-db';
import { promoteAdminUsers } from './admin-promote';

/**
 * US-6 boot promotion: any VERIFIED user whose email is listed in the
 * `ADMIN_EMAIL` env var becomes `admin` at boot. Fails safe — never blocks
 * server startup. Login-time promotion is handled by better-auth
 * `databaseHooks.session.create.after` (better-auth.instance.ts).
 */
@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(@Inject(APP_CONFIG) private readonly appConfig: AppConfig) {}

  async onModuleInit(): Promise<void> {
    try {
      if (!this.appConfig.adminEmails.length) return;
      const promoted = await promoteAdminUsers(
        getAuthKysely(this.appConfig.databaseUrl),
        this.appConfig.adminEmails,
      );
      if (promoted.length) this.logger.log(`admin bootstrap promoted: ${promoted.join(', ')}`);
    } catch (e) {
      this.logger.warn(
        `admin bootstrap skipped: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
