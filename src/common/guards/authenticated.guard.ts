import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

/**
 * Auth enforcement for Nest-owned routes that need ANY signed-in user (todos).
 * Reads the `authUser` attached by BetterAuthSessionGuard (global APP_GUARD).
 * Ownership scoping itself lives in the service (user_id on every query).
 */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (request?.authUser) return true;
    throw new UnauthorizedException('Authentication required');
  }
}
