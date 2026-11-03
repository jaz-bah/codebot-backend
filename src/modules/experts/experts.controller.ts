import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedGuard } from '../../common/guards/authenticated.guard';
import { JoiValidationPipe } from '../../common/pipes/joi-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Expert } from '../../database/typeorm/entities/expert.entity';
import { createExpertSchema, CreateExpertDto } from './dto/create-expert.dto';
import { queryExpertsSchema, QueryExpertsDto } from './dto/query-experts.dto';
import { updateExpertSchema, UpdateExpertDto } from './dto/update-expert.dto';
import { ExpertsService, ExpertPage } from './experts.service';

/**
 * User-owned expert surface. Guard chain: BetterAuthSessionGuard (global)
 * attaches authUser → AuthenticatedGuard rejects anonymous calls; ownership
 * scoping is enforced by ExpertsService (user_id on EVERY query — PRD D2).
 */
@Controller('experts')
@UseGuards(AuthenticatedGuard)
export class ExpertsController {
  constructor(private readonly experts: ExpertsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(createExpertSchema)) dto: CreateExpertDto,
  ): Promise<Expert> {
    return this.experts.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryExpertsSchema)) query: QueryExpertsDto,
  ): Promise<ExpertPage> {
    return this.experts.list(user.id, query ?? ({} as QueryExpertsDto));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Expert> {
    return this.experts.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new JoiValidationPipe(updateExpertSchema)) dto: UpdateExpertDto,
  ): Promise<Expert> {
    return this.experts.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean; id: string }> {
    return this.experts.remove(user.id, id);
  }
}
