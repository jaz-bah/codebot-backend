import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import { AUTH_INSTANCE } from '../../modules/auth/auth.module';
import { AuthInstance } from '../../modules/auth/better-auth.instance';

/**
 * Global (APP_GUARD) — resolves the BetterAuth session once per request and
 * attaches `{user, session}` to the request as `authUser`/`authSession`.
 *
 * - `/api/auth/**` is BetterAuth's own territory (PRD D4) → pass-through.
 * - It does NOT reject anonymous requests by itself; enforcement is explicit
 *   via `@Roles(...)` + AdminGuard (keeps public Nest routes public).
 */
@Injectable()
export class BetterAuthSessionGuard implements CanActivate {
  constructor(@Inject(AUTH_INSTANCE) private readonly auth: AuthInstance) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (typeof request?.originalUrl === 'string') {
      const path = request.originalUrl.split('?')[0];
      if (path.startsWith('/api/auth/')) return true;
    }
    if (!request?.headers) return true;

    try {
      const session = await this.auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (session?.user) {
        request.authUser = session.user;
        request.authSession = session.session;
      }
    } catch {
      // Must never break request handling; endpoints requiring auth enforce
      // via @Roles/AdminGuard and will simply see no authUser.
    }
    return true;
  }
}
