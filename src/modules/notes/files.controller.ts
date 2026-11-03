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
import { WorkspaceFile, WorkspaceFileNode } from '../../database/typeorm/entities/workspace-file.entity';
import { createFileSchema, CreateFileDto } from './dto/create-file.dto';
import { queryFilesSchema, QueryFilesDto } from './dto/query-files.dto';
import { updateFileSchema, UpdateFileDto } from './dto/update-file.dto';
import { FilesService, FilePage } from './files.service';

/**
 * User-owned workspace file tree (folders + HTML note files). Non-param routes
 * (tree) are declared before the `:id` routes so Nest matches them first.
 * Ownership scoping is enforced by FilesService (user_id on EVERY query).
 */
@Controller('files')
@UseGuards(AuthenticatedGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get('tree')
  tree(@CurrentUser() user: AuthenticatedUser): Promise<WorkspaceFileNode[]> {
    return this.files.tree(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(createFileSchema)) dto: CreateFileDto,
  ): Promise<WorkspaceFile> {
    return this.files.create(user.id, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryFilesSchema)) query: QueryFilesDto,
  ): Promise<FilePage> {
    return this.files.list(user.id, query ?? ({} as QueryFilesDto));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new JoiValidationPipe(updateFileSchema)) dto: UpdateFileDto,
  ): Promise<WorkspaceFile> {
    return this.files.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean; id: string }> {
    return this.files.remove(user.id, id);
  }
}
