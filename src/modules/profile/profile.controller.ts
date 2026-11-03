import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthenticatedGuard } from '../../common/guards/authenticated.guard';
import { JoiValidationPipe } from '../../common/pipes/joi-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { updateProfileSchema, UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';
import { singleFileUpload } from '../uploads/multer-file.interceptor';
import type { UploadFile } from '../uploads/multer-file.interceptor';
import { IMAGE_MAX_BYTES } from '../uploads/upload-file-types';
import { UploadsService } from '../uploads/uploads.service';
import type { ProfileView } from '../../database/typeorm/entities/profile.entity';

/**
 * Profile handles + profile image + live domain counts. Guard chain:
 * BetterAuthSessionGuard (global) attaches authUser → AuthenticatedGuard
 * rejects anonymous calls. The profile row is created lazily on first GET;
 * counts are computed per request, never stored. The image flows through the
 * SAME Cloudinary pipeline as /uploads (per-user credentials from /settings).
 */
@Controller('profile')
@UseGuards(AuthenticatedGuard)
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly uploads: UploadsService,
  ) {}

  /** GET /profile — get-or-create + user info + live counts. */
  @Get()
  view(@CurrentUser() user: AuthenticatedUser): Promise<ProfileView> {
    return this.profile.view(user.id, user);
  }

  /** PATCH /profile — claim a custom nickname (409 when taken). */
  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new JoiValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
  ): Promise<ProfileView> {
    return this.profile.update(user.id, dto);
  }

  /** POST /profile/nickname/rotate — discard the handle, fresh auto-gen one. */
  @Post('nickname/rotate')
  rotate(@CurrentUser() user: AuthenticatedUser): Promise<ProfileView> {
    return this.profile.rotate(user.id);
  }

  /**
   * PATCH /profile/image — multipart field `file` (jpg/png/webp/gif ≤ 10 MB,
   * same magic-byte validation as /uploads/images). Uploaded to the user's
   * own Cloudinary account, the URL is persisted on the auth `user.image`
   * column and the updated profile view is returned.
   */
  @Patch('image')
  @UseInterceptors(singleFileUpload('file', IMAGE_MAX_BYTES))
  async setProfileImage(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadFile,
  ): Promise<ProfileView> {
    const uploaded = await this.uploads.uploadImage(user.id, file);
    return this.profile.setImage(user.id, uploaded.url);
  }

  /** DELETE /profile/image — remove the current profile image (null row). */
  @Delete('image')
  clearProfileImage(@CurrentUser() user: AuthenticatedUser): Promise<ProfileView> {
    return this.profile.clearImage(user.id);
  }
}
