import { Injectable } from '@nestjs/common';
import { Client } from 'pg';
import { sslFromUrl } from '../../database/ssl';

export interface HealthStatus {
  ok: boolean;
  db: 'up' | 'down';
}

/**
 * DB ping via the same `pg` driver both layers use. Lazy short-lived client so
 * /health stays cheap and never leaks connections (ARCHITECTURE §8: smoke test).
 */
@Injectable()
export class HealthService {
  async check(): Promise<HealthStatus> {
    const url = process.env.DATABASE_URL;
    if (!url) return { ok: false, db: 'down' };

    const client = new Client({
      connectionString: url,
      connectionTimeoutMillis: 2000,
      ssl: sslFromUrl(url),
    });
    try {
      await client.connect();
      await client.query('select 1');
      return { ok: true, db: 'up' };
    } catch {
      return { ok: false, db: 'down' };
    } finally {
      void client.end().catch(() => undefined);
    }
  }
}
