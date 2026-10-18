import { PoolConfig } from 'pg';

/**
 * Single source of truth for SSL decisions, derived from the connection URL's
 * `sslmode` param (Postgres convention):
 * - `sslmode=require|verify-ca|verify-full` → SSL on
 *   (`verify-*` validates certs; `require` accepts self-signed server certs)
 * - anything else (`disable`, `allow`, `prefer`, absent) → SSL off
 */
export function sslFromUrl(
  databaseUrl: string,
): false | { rejectUnauthorized: boolean } {
  const mode = databaseUrl.match(/sslmode=([a-z-]+)/)?.[1];

  if (mode === 'verify-ca' || mode === 'verify-full') {
    return { rejectUnauthorized: true };
  }
  if (mode === 'require') {
    return { rejectUnauthorized: false };
  }
  return false;
}
