import { AuthenticatedGuard } from '../src/common/guards/authenticated.guard';

/** Hand-rolled ExecutionContext stub (same style as admin.guard.spec.ts). */
class ExecutionContextStub {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public requestStub: Record<string, any>) {}
  switchToHttp = () => ({ getRequest: () => this.requestStub });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getType = (): any => 'http';
}

describe('AuthenticatedGuard (todos surface)', () => {
  const guard = new AuthenticatedGuard();

  it('passes when BetterAuthSessionGuard attached an authUser', () => {
    const stub = new ExecutionContextStub({ authUser: { id: 'u1', email: 'a@b.c' } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(guard.canActivate(stub as any)).toBe(true);
  });

  it('rejects anonymous calls with 401', () => {
    const stub = new ExecutionContextStub({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => guard.canActivate(stub as any)).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });

  it('rejects when request itself is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => guard.canActivate(new ExecutionContextStub(undefined as any) as any)).toThrow(
      expect.objectContaining({ status: 401 }),
    );
  });
});
