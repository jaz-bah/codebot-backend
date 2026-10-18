/**
 * Standalone/CLI-friendly BetterAuth export (no Nest DI).
 * Runtime code uses auth.module.ts (DI) instead — never import this there.
 */
import 'dotenv/config';
import { configuration } from '../../config/configuration';
import { MailService } from '../mail/mail.service';
import { buildAuth } from './better-auth.instance';

const appConfig = configuration();
const mail = new MailService(appConfig);
mail.onModuleInit();

export const auth = buildAuth({ config: appConfig, mail });
