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
import { Tool } from '../../database/typeorm/entities/tool.entity';
import { createToolSchema, CreateToolDto } from './dto/create-tool.dto';
import { queryToolsSchema, QueryToolsDto } from './dto/query-tools.dto';
import { updateToolSchema, UpdateToolDto } from './dto/update-tool.dto';
import { ToolsService, ToolPage } from './tools.service';

/**
 * User-owned tool surface. Guard chain: BetterAuthSessionGuard (global)
 * attaches authUser → AuthenticatedGuard rejects anonymous calls; ownership
 * scoping is enforced by ToolsService (user_id on EVERY query — PRD D2).
 */
@Controller('tools')
@UseGuards(AuthenticatedGuard)
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(createToolSchema)) dto: CreateToolDto,
  ): Promise<Tool> {
    return this.tools.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryToolsSchema)) query: QueryToolsDto,
  ): Promise<ToolPage> {
    return this.tools.list(user.id, query ?? ({} as QueryToolsDto));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Tool> {
    return this.tools.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new JoiValidationPipe(updateToolSchema)) dto: UpdateToolDto,
  ): Promise<Tool> {
    return this.tools.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean; id: string }> {
    return this.tools.remove(user.id, id);
  }
}
