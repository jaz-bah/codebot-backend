import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthenticatedGuard } from '../../common/guards/authenticated.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UploadFile, singleFileUpload } from './multer-file.interceptor';
import { IMAGE_MAX_BYTES, ZIP_MAX_BYTES } from './upload-file-types';
import { UploadResult, UploadsService } from './uploads.service';

/**
 * Upload surface backed by the user's own Cloudinary credentials (from
 * /settings). Guard chain: BetterAuthSessionGuard (global) attaches authUser →
 * AuthenticatedGuard rejects anonymous calls. Multipart field name: `file`.
 */
@Controller('uploads')
@UseGuards(AuthenticatedGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('images')
  @UseInterceptors(singleFileUpload('file', IMAGE_MAX_BYTES))
  uploadImage(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadFile,
  ): Promise<UploadResult> {
    return this.uploads.uploadImage(user.id, file);
  }

  @Post('zips')
  @UseInterceptors(singleFileUpload('file', ZIP_MAX_BYTES))
  uploadZip(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadFile,
  ): Promise<UploadResult> {
    return this.uploads.uploadZip(user.id, file);
  }
}
