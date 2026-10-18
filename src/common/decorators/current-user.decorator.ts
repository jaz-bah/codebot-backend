import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  role: string;
  image: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined =>
    ctx.switchToHttp().getRequest().authUser,
);

export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): unknown => ctx.switchToHttp().getRequest().authSession,
);
