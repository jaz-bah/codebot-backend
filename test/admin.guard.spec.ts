import { AdminGuard } from '../src/common/guards/admin.guard';
import { AuditService } from '../src/modules/admin/audit.service';
import { shouldPromote } from '../src/modules/admin/admin-promote';
import { Reflector } from '@nestjs/core';

/**
 * Guard unit tests use a hand-rolled ExecutionContext stub — no Nest testing
 * module needed (the guard is plain TypeScript apart from decorators).
 */
class ExecutionContextStub {
  constructor(
    public requestStub: Record<string, unknown>,
    public handlerMeta = {},
  ) {}
  getHandler(): unknown {
    return this.handlerMeta;
  }
  getClass(): unknown {
    return this.handlerMeta;
  }
  switchToHttp = (): { getRequest: () => Record<string, unknown> } => ({
    getRequest: () => this.requestStub,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  switchToWs = (): any => ({});
  getType = () => 'http';
}

function makeGuard(reflectorImpl: (key: string) => string[] | undefined): {
  guard: AdminGuard;
  auditSpy: jest.SpyInstance;
} {
  const reflector = { getAllAndOverride: jest.fn(reflectorImpl) } as unknown as Reflector;
  const audit = { log: jest.fn(async () => void 0), recentForUser: jest.fn() } as unknown as AuditService;
  const guard = new AdminGuard(reflector, audit);
  return { guard, auditSpy: audit.log as unknown as jest.SpyInstance };
}

describe('AdminGuard (Phase 3)', () => {
  it('authUser missing → UnauthorizedException', async () => {
    const { guard } = makeGuard(() => ['admin']);
    const stub = new ExecutionContextStub({ originalUrl: '/admin/stats', method: 'GET' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(guard.canActivate(stub as any)).rejects.toMatchObject({ status: 401 });
  });

  it('non-admin user role → ForbiddenException + audit ACCESS_DENIED row', async () => {
    const { guard, auditSpy } = makeGuard(() => ['admin']);
    const stub = new ExecutionContextStub({
      originalUrl: '/admin/stats',
      method: 'GET',
      authUser: { id: 'u1', email: 'a@b.c', role: 'user' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(guard.canActivate(stub as any)).rejects.toMatchObject({ status: 403 });
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      email: 'a@b.c',
      action: 'ACCESS_DENIED',
    });
  });

  it('admin user → allowed, no audit row', async () => {
    const { guard, auditSpy } = makeGuard(() => ['admin']);
    const stub = new ExecutionContextStub({
      originalUrl: '/admin/stats',
      authUser: { id: 'a1', email: 'admin@x.y', role: 'admin', emailVerified: true },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(guard.canActivate(stub as any)).resolves.toBe(true);
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('/api/auth/** paths are pass-through (BetterAuth-owned)', async () => {
    const { guard } = makeGuard(() => ['admin']);
    const stub = new ExecutionContextStub({ originalUrl: '/api/auth/get-session' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(guard.canActivate(stub as any)).resolves.toBe(true);
  });
});

describe('shouldPromote (US-6 decision logic)', () => {
  const ADMIN = ['Owner@Example.com'];

  it('verified matching email (case-insensitive) → true', () => {
    expect(
      shouldPromote({ email: 'owner@example.com', emailVerified: true, role: 'user' }, ADMIN),
    ).toBe(true);
  });

  it('unverified → never promoted', () => {
    expect(
      shouldPromote({ email: 'owner@example.com', emailVerified: false, role: 'user' }, ADMIN),
    ).toBe(false);
  });

  it('already admin → false (idempotent)', () => {
    expect(
      shouldPromote({ email: 'owner@example.com', emailVerified: true, role: 'admin' }, ADMIN),
    ).toBe(false);
  });

  it('not in list → false', () => {
    expect(
      shouldPromote({ email: 'someone-else@x.com', emailVerified: true, role: 'user' }, ADMIN),
    ).toBe(false);
  });

  it('empty ADMIN list → false', () => {
    expect(
      shouldPromote({ email: 'owner@example.com', emailVerified: true, role: 'user' }, []),
    ).toBe(false);
  });

  it('whitespace in admin emails is tolerated', () => {
    expect(
      shouldPromote(
        { email: 'owner@example.com', emailVerified: true, role: 'user' },
        [' owner@example.com ', ''],
      ),
    ).toBe(true);
  });
});
