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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthenticatedGuard } from '../../common/guards/authenticated.guard';
import { JoiValidationPipe } from '../../common/pipes/joi-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Document } from '../../database/typeorm/entities/document.entity';
import { UploadFile, singleFileUpload } from '../uploads/multer-file.interceptor';
import { DOCUMENT_MAX_BYTES } from './dto/document.constants';
import { createDocumentSchema, CreateDocumentDto } from './dto/create-document.dto';
import { queryDocumentsSchema, QueryDocumentsDto } from './dto/query-documents.dto';
import { updateDocumentSchema, UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentsService, DocumentPage } from './documents.service';

/**
 * User-owned document library (uploaded file + name + description + url).
 * Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls. Ownership scoping is enforced
 * by DocumentsService (user_id on EVERY query). Multipart field name: `file`.
 */
@Controller('documents')
@UseGuards(AuthenticatedGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @UseInterceptors(singleFileUpload('file', DOCUMENT_MAX_BYTES))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadFile,
    @Body(new JoiValidationPipe(createDocumentSchema)) dto: CreateDocumentDto,
  ): Promise<Document> {
    return this.documents.create(user.id, dto ?? ({} as CreateDocumentDto), file);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new JoiValidationPipe(queryDocumentsSchema)) query: QueryDocumentsDto,
  ): Promise<DocumentPage> {
    return this.documents.list(user.id, query ?? ({} as QueryDocumentsDto));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Document> {
    return this.documents.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new JoiValidationPipe(updateDocumentSchema)) dto: UpdateDocumentDto,
  ): Promise<Document> {
    return this.documents.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean; id: string }> {
    return this.documents.remove(user.id, id);
  }
}
