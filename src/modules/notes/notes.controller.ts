import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedGuard } from '../../common/guards/authenticated.guard';
import { JoiValidationPipe } from '../../common/pipes/joi-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { queryNotesSchema, QueryNotesDto } from './dto/query-notes.dto';
import { updateNoteSchema, UpdateNoteDto } from './dto/update-note.dto';
import { NotesService, NoteDetail, NotePage } from './notes.service';

/**
 * User-owned note content (rich HTML). A note is addressed by its 1:1
 * workspace `file` id. Ownership scoping is enforced by NotesService.
 */
@Controller('notes')
@UseGuards(AuthenticatedGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryNotesSchema)) query: QueryNotesDto,
  ): Promise<NotePage> {
    return this.notes.list(user.id, query ?? ({} as QueryNotesDto));
  }

  @Get(':fileId')
  getByFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<NoteDetail> {
    return this.notes.getByFile(user.id, fileId);
  }

  @Patch(':fileId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body(new JoiValidationPipe(updateNoteSchema)) dto: UpdateNoteDto,
  ): Promise<NoteDetail> {
    return this.notes.update(user.id, fileId, dto);
  }
}
