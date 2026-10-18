import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { buildAuth, AuthInstance } from './better-auth.instance';
import { APP_CONFIG } from '../../config/app-config.token';
import { AppConfig } from '../../config/configuration';
import { MailService } from '../mail/mail.service';

/**
 * Provides the app-wide BetterAuth instance via DI so that the mail callbacks
 * use the same MailService as the rest of the app (ARCHITECTURE §4).
 */
export const AUTH_INSTANCE = 'AUTH_INSTANCE';

@Module({
  imports: [MailModule],
  providers: [
    {
      provide: AUTH_INSTANCE,
      useFactory: (appConfig: AppConfig, mail: MailService): AuthInstance =>
        buildAuth({ config: appConfig, mail }),
      inject: [APP_CONFIG, MailService],
    },
  ],
  exports: [AUTH_INSTANCE],
})
export class AuthModule {}
