import { Inject, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_CONFIG } from '../../config/app-config.token';
import { buildAuth, AuthInstance } from './better-auth.instance';
import { AppConfig } from '../../config/configuration';

/**
 * Provides the app-wide BetterAuth instance via DI so that mail/transport
 * wiring (Phase 1) can receive Nest-provided services (ARCHITECTURE §4).
 */
export const AUTH_INSTANCE = 'AUTH_INSTANCE';

@Module({
  providers: [
    {
      provide: AUTH_INSTANCE,
      useFactory: (appConfig: AppConfig): AuthInstance =>
        buildAuth({ config: appConfig }),
      inject: [APP_CONFIG],
    },
  ],
  exports: [AUTH_INSTANCE],
})
export class AuthModule {}
