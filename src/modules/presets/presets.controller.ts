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
import { Preset } from '../../database/typeorm/entities/preset.entity';
import { createPresetSchema, CreatePresetDto } from './dto/create-preset.dto';
import { queryPresetsSchema, QueryPresetsDto } from './dto/query-presets.dto';
import { updatePresetSchema, UpdatePresetDto } from './dto/update-preset.dto';
import { PresetsService, PresetPage } from './presets.service';

/**
 * User-owned preset surface. Guard chain: BetterAuthSessionGuard (global)
 * attaches authUser → AuthenticatedGuard rejects anonymous calls; ownership
 * scoping is enforced by PresetsService (user_id on EVERY query — PRD D2).
 */
@Controller('presets')
@UseGuards(AuthenticatedGuard)
export class PresetsController {
  constructor(private readonly presets: PresetsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(createPresetSchema)) dto: CreatePresetDto,
  ): Promise<Preset> {
    return this.presets.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryPresetsSchema)) query: QueryPresetsDto,
  ): Promise<PresetPage> {
    return this.presets.list(user.id, query ?? ({} as QueryPresetsDto));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Preset> {
    return this.presets.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new JoiValidationPipe(updatePresetSchema)) dto: UpdatePresetDto,
  ): Promise<Preset> {
    return this.presets.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean; id: string }> {
    return this.presets.remove(user.id, id);
  }
}
