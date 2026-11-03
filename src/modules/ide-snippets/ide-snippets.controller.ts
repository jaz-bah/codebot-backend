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
import { IdeSnippet } from '../../database/typeorm/entities/ide-snippet.entity';
import { createIdeSnippetSchema, CreateIdeSnippetDto } from './dto/create-ide-snippet.dto';
import { queryIdeSnippetsSchema, QueryIdeSnippetsDto } from './dto/query-ide-snippets.dto';
import { updateIdeSnippetSchema, UpdateIdeSnippetDto } from './dto/update-ide-snippet.dto';
import { IdeSnippetsService, IdeSnippetPage } from './ide-snippets.service';

/**
 * User-owned IDE snippet surface. Guard chain: BetterAuthSessionGuard
 * (global) attaches authUser → AuthenticatedGuard rejects anonymous calls;
 * ownership scoping is enforced by IdeSnippetsService (user_id on EVERY
 * query — PRD D2).
 */
@Controller('ide-snippets')
@UseGuards(AuthenticatedGuard)
export class IdeSnippetsController {
  constructor(private readonly ideSnippets: IdeSnippetsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(createIdeSnippetSchema)) dto: CreateIdeSnippetDto,
  ): Promise<IdeSnippet> {
    return this.ideSnippets.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryIdeSnippetsSchema)) query: QueryIdeSnippetsDto,
  ): Promise<IdeSnippetPage> {
    return this.ideSnippets.list(user.id, query ?? ({} as QueryIdeSnippetsDto));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IdeSnippet> {
    return this.ideSnippets.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new JoiValidationPipe(updateIdeSnippetSchema)) dto: UpdateIdeSnippetDto,
  ): Promise<IdeSnippet> {
    return this.ideSnippets.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean; id: string }> {
    return this.ideSnippets.remove(user.id, id);
  }
}
