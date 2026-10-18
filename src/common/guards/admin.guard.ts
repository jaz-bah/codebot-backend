import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuditService } from '../../modules/admin/audit.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Role enforcement for Nest-owned routes. Reads `@Roles(...)` metadata and the
 * `authUser` attached by BetterAuthSessionGuard. Coins an audit row on every
 * denial (401 + 403) with sanitized context only.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (typeof request?.originalUrl === 'string') {
      const path = request.originalUrl.split('?')[0];
      if (path.startsWith('/api/auth/')) return true; // defense-in-depth no-op
    }

    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const user: AuthenticatedUser | undefined = request?.authUser;

    if (!user) {
      await this.fail(context, null, 'Authentication required');
      throw new UnauthorizedException('Authentication required');
    }
    if (required?.length && !required.includes(user.role)) {
      await this.fail(context, user, `missing role(s): ${required.join(', ')}`);
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }

  private async fail(
    context: ExecutionContext,
    user: AuthenticatedUser | null,
    reason: string,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest();
    await this.audit.log({
      userId: user?.id ?? null,
      email: user?.email ?? null,
      action: 'ACCESS_DENIED',
      detail: {
        reason,
        path: typeof request?.originalUrl === 'string' ? request.originalUrl.split('?')[0] : null,
        method: request?.method ?? null,
        ip: request?.ip ?? null,
      },
    });
  }
}
