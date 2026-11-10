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
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Artboard } from '../../database/typeorm/entities/artboard.entity';
import { createArtboardSchema, CreateArtboardDto } from './dto/create-artboard.dto';
import { queryArtboardsSchema, QueryArtboardsDto } from './dto/query-artboards.dto';
import { updateArtboardSchema, UpdateArtboardDto } from './dto/update-artboard.dto';
import { ArtboardsService, ArtboardPage } from './artboards.service';

/**
 * User-owned artboard surface. Routes WITHOUT a param are declared before the
 * `:id` routes so Nest matches them first.
 */
@Controller('artboards')
@UseGuards(AuthenticatedGuard)
export class ArtboardsController {
  constructor(private readonly artboards: ArtboardsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(createArtboardSchema)) dto: CreateArtboardDto,
  ): Promise<Artboard> {
    return this.artboards.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryArtboardsSchema)) query: QueryArtboardsDto,
  ): Promise<ArtboardPage> {
    return this.artboards.list(user.id, query ?? ({} as QueryArtboardsDto));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Artboard> {
    return this.artboards.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new JoiValidationPipe(updateArtboardSchema)) dto: UpdateArtboardDto,
  ): Promise<Artboard> {
    return this.artboards.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean; id: string }> {
    return this.artboards.remove(user.id, id);
  }
}
