import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/typeorm/entities/audit-log.entity';
import { AppDataSource } from '../../database/typeorm/data-source';

/**
 * Writes audit events into the DOMAIN-owned audit_log table (TypeORM, PRD D2).
 * Audit failures must NEVER break the auth flow: everything fails-safe.
 */
@Injectable()
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);
  private repo: Repository<AuditLog> | null = null;

  onModuleInit(): void {
    this.ensureRepo().catch((e) =>
      this.logger.warn(`audit repo init deferred: ${e instanceof Error ? e.message : String(e)}`),
    );
  }

  private async ensureRepo(): Promise<Repository<AuditLog>> {
    if (!this.repo) {
      if (!AppDataSource.isInitialized) await AppDataSource.initialize();
      this.repo = AppDataSource.getRepository(AuditLog);
    }
    return this.repo;
  }

  /**
   * Record a security-relevant event. Resolves silently even when the DB
   * write fails (logged, never thrown) — FR-9-style fail safety.
   */
  async log(event: {
    userId?: string | null;
    email?: string | null;
    action: string;
    detail?: Record<string, unknown> | null;
  }): Promise<void> {
    try {
      const repo = await this.ensureRepo();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await repo.insert({
        userId: event.userId ?? null,
        email: event.email ?? null,
        action: event.action,
        detail: event.detail ?? null, // jsonb column accepts the plain object
      } as never);
    } catch (e) {
      this.logger.warn(
        `audit write failed for ${event.action}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Never log secrets — sanitize every payload once, centrally. DO NOT use for debug of secrets. */
  static sanitizeDetail(input: Record<string, unknown>): Record<string, unknown> {
    const FORBIDDEN = /^(pass(word)?|token|secret|cookie|session_token|authorization)$/i;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (FORBIDDEN.test(k)) continue;
      out[k] = v;
    }
    return out;
  }

  /** Reserved for Phase 4/5 uses (admin list of audit events). Kept offline. */
  async recentForUser(userId: string, limit = 20): Promise<AuditLog[]> {
    const repo = await this.ensureRepo();
    return repo.createQueryBuilder('a')
      .where('a.userId = :userId', { userId })
      .orderBy('a.createdAt', 'DESC')
      .take(limit)
      .getMany();
  }
}
