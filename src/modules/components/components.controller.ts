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
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ComponentWithFiles } from '../../database/typeorm/entities/component.entity';
import { createComponentSchema, CreateComponentDto } from './dto/create-component.dto';
import { queryComponentsSchema, QueryComponentsDto } from './dto/query-components.dto';
import { updateComponentSchema, UpdateComponentDto } from './dto/update-component.dto';
import { ComponentsService, ComponentPage } from './components.service';

/**
 * User-owned UI component library (snippet + preview + code files).
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls. Ownership scoping is enforced
 * by ComponentsService (user_id on EVERY query).
 */
@Controller('components')
@UseGuards(AuthenticatedGuard)
export class ComponentsController {
  constructor(private readonly components: ComponentsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(createComponentSchema)) dto: CreateComponentDto,
  ): Promise<ComponentWithFiles> {
    return this.components.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryComponentsSchema)) query: QueryComponentsDto,
  ): Promise<ComponentPage> {
    return this.components.list(user.id, query ?? ({} as QueryComponentsDto));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ComponentWithFiles> {
    return this.components.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new JoiValidationPipe(updateComponentSchema)) dto: UpdateComponentDto,
  ): Promise<ComponentWithFiles> {
    return this.components.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean; id: string }> {
    return this.components.remove(user.id, id);
  }
}
