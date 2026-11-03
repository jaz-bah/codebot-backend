import { ConfigService } from '@nestjs/config';
import { AppConfig } from './configuration';

/**
 * The typed AppConfig is exposed as a DI token by AppModule, so every module
 * injects a validated, typed config object instead of raw env access.
 */
export const APP_CONFIG = 'APP_CONFIG';

/** Maps the flat ConfigService keys (from load: [configuration]) to AppConfig.
 *  Keys are guaranteed present: Joi-validated with defaults at boot. */
export function readAppConfig(cs: ConfigService): AppConfig {
  return {
    nodeEnv: cs.get('nodeEnv') as AppConfig['nodeEnv'],
    port: cs.get<number>('port') as number,
    appUrl: cs.get<string>('appUrl') as string,
    databaseUrl: cs.get<string>('databaseUrl') as string,
    betterAuthSecret: cs.get<string>('betterAuthSecret') as string,
    corsOriginUrls: cs.get<string[]>('corsOriginUrls') as string[],
    adminEmails: cs.get<string[]>('adminEmails') as string[],
    smtp: cs.get<AppConfig['smtp']>('smtp') as AppConfig['smtp'],
    oauth: cs.get<AppConfig['oauth']>('oauth') as AppConfig['oauth'],
    throttle: cs.get<AppConfig['throttle']>('throttle') as AppConfig['throttle'],
    settings: cs.get<AppConfig['settings']>('settings') as AppConfig['settings'],
  };
}
