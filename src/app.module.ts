import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { configuration } from './config/configuration';
import { APP_CONFIG } from './config/app-config.token';
import { AppConfig } from './config/configuration';
import { AppConfigModule } from './config/app-config.module';
import { envValidationSchema } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
import { BetterAuthSessionGuard } from './common/guards/better-auth-session.guard';
import { AdminGuard } from './common/guards/admin.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    // Nest-owned routes rate limiting (auth endpoints are covered by
    // BetterAuth's own rateLimit — see better-auth.instance.ts).
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (appConfig: AppConfig) => [
        { ttl: appConfig.throttle.ttlMs, limit: appConfig.throttle.limit },
      ],
    }),
    AppConfigModule,
    MailModule,
    AuthModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: BetterAuthSessionGuard },
    // AdminGuard is per-controller (needs Reflector + AuditService + @Roles)
  ],
})
export class AppModule {}
