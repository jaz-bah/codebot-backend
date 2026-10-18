/**
 * Inspect BetterAuth's expected auth tables (what the CLI generate/migrate uses).
 * Run: npx ts-node scripts/inspect-auth-schema.ts
 */
import 'dotenv/config';
import { configuration } from '../src/config/configuration';
import { MailService } from '../src/modules/mail/mail.service';
import { buildAuth } from '../src/modules/auth/better-auth.instance';
import { getAuthTables } from 'better-auth';

const appConfig = configuration();
const mail = new MailService(appConfig);
mail.onModuleInit();
const auth = buildAuth({ config: appConfig, mail });
const tables = getAuthTables(auth.options);
console.log(JSON.stringify(tables, null, 2));
process.exit(0);
