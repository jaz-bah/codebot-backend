import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedGuard } from '../../common/guards/authenticated.guard';
import { JoiValidationPipe } from '../../common/pipes/joi-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { searchQuerySchema, SearchQueryDto } from './dto/search.dto';
import { SearchService, SearchResponse } from './search.service';

/**
 * Unified scoped search (`GET /search?q=@presets name …`). Guard chain:
 * BetterAuthSessionGuard (global) attaches authUser → AuthenticatedGuard
 * rejects anonymous calls. Ownership scoping is enforced by SearchService —
 * user_id on EVERY per-scope query.
 */
@Controller('search')
@UseGuards(AuthenticatedGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  query(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(searchQuerySchema)) dto: SearchQueryDto,
  ): Promise<SearchResponse> {
    return this.search.search(user.id, { limit: 10, ...dto });
  }
}
