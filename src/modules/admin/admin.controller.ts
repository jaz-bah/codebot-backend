import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminService, AdminStats, AdminUserRow } from './admin.service';

/**
 * Admin-only analytics surface (US-7). Guard chain:
 * BetterAuthSessionGuard (global) attaches authUser → AdminGuard + @Roles.
 */
@Controller('admin')
@UseGuards(AdminGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  async stats(): Promise<AdminStats> {
    return this.admin.stats();
  }

  @Get('users')
  async users(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<{
    items: AdminUserRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const n = (v: string | undefined, dflt: number): number => {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : dflt;
    };
    return this.admin.listUsers(n(page, 1), n(limit, 20));
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user; // smoke endpoint proving the guard chain + decorator wiring
  }
}
