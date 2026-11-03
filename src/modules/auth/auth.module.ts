import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { createSocketSessionVerifier } from './socket-session-verifier';
import { buildAuth, AuthInstance } from './better-auth.instance';
import { APP_CONFIG } from '../../config/app-config.token';
import { AppConfig } from '../../config/configuration';
import { MailService } from '../mail/mail.service';

/**
 * Provides the app-wide BetterAuth instance via DI so that the mail callbacks
 * use the same MailService as the rest of the app (ARCHITECTURE §4).
 */
export const AUTH_INSTANCE = 'AUTH_INSTANCE';

/** Per-handshake WS session verifier (signed cookie → DB session row). */
export const WS_SESSION_VERIFIER = 'WS_SESSION_VERIFIER';

/**
 * The WS verifier reads the secret + DATABASE_URL straight from APP_CONFIG so
 * it stays independent of the BetterAuth instance object (no ESM shim quirks
 * in the socket handshake path; jest-friendly).
 */
@Module({
  imports: [MailModule],
  providers: [
    {
      provide: AUTH_INSTANCE,
      useFactory: (appConfig: AppConfig, mail: MailService): AuthInstance =>
        buildAuth({ config: appConfig, mail }),
      inject: [APP_CONFIG, MailService],
    },
    {
      provide: WS_SESSION_VERIFIER,
      useFactory: (appConfig: AppConfig) =>
        createSocketSessionVerifier({
          databaseUrl: appConfig.databaseUrl,
          secret: appConfig.betterAuthSecret,
        }),
      inject: [APP_CONFIG],
    },
  ],
  exports: [AUTH_INSTANCE, WS_SESSION_VERIFIER],
})
export class AuthModule {}
