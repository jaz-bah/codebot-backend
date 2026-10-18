import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_CONFIG, readAppConfig } from './app-config.token';

/**
 * Exposes the fully-validated, typed AppConfig as APP_CONFIG.
 * @Global() so every module can inject it without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (configService: ConfigService) => readAppConfig(configService),
      inject: [ConfigService],
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
