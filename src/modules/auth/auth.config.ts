/**
 * CLI-friendly BetterAuth export. The @better-auth/cli needs a module that
 * exports the auth instance directly (no factory/DI). Runtime code uses
 * better-auth.instance.ts via DI instead.
 *
 * Reads process.env — run CLI commands with .env in cwd (dotenv via env-cmd
 * or shell). Used by: `npx @better-auth/cli generate --config <this file>`
 */
import 'dotenv/config';
import { configuration } from '../../config/configuration';
import { buildAuth } from './better-auth.instance';

export const auth = buildAuth({ config: configuration() });
