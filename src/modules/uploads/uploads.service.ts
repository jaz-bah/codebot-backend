import { BadRequestException, Inject, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { CloudinaryClient, CloudinaryResourceType, CloudinaryUploadResult } from './cloudinary-client';
import type { CloudinaryCredentials } from './cloudinary-credentials';
import { UploadFile } from './multer-file.interceptor';
import { IMAGE_MAX_BYTES, ZIP_MAX_BYTES, detectImageKind, looksLikeZip, sanitizeFilename } from './upload-file-types';
import { SettingsService } from '../settings/settings.service';

export interface UploadResult extends CloudinaryUploadResult {
  /** Original (sanitized) filename, echoed back for convenience. */
  filename: string;
}

/**
 * Uploads user files to the user's OWN Cloudinary account using the
 * credentials they stored via PATCH /settings (decrypted server-side only).
 * Files are validated by magic bytes before leaving the server; nothing is
 * persisted in our database — the Cloudinary URL is returned to the caller.
 */
@Injectable()
export class UploadsService {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    private readonly cloudinary: CloudinaryClient,
  ) {}

  /** Images: jpg/jpeg, png, webp, gif — max 10 MB. */
  async uploadImage(userId: string, file: UploadFile | undefined): Promise<UploadResult> {
    const f = this.assertFilePresent(file);
    if (f.size > IMAGE_MAX_BYTES) {
      throw new PayloadTooLargeException(`image exceeds the ${IMAGE_MAX_BYTES} byte limit`);
    }
    const kind = detectImageKind(f.buffer);
    if (!kind) {
      throw new BadRequestException('file content does not look like a supported image (jpg, png, webp, gif)');
    }
    return this.uploadToCloudinary(userId, f, 'image');
  }

  /** ZIP archives — max 50 MB. */
  async uploadZip(userId: string, file: UploadFile | undefined): Promise<UploadResult> {
    const f = this.assertFilePresent(file);
    if (f.size > ZIP_MAX_BYTES) {
      throw new PayloadTooLargeException(`zip exceeds the ${ZIP_MAX_BYTES} byte limit`);
    }
    if (!looksLikeZip(f.buffer)) {
      throw new BadRequestException('file content does not look like a zip archive');
    }
    return this.uploadToCloudinary(userId, f, 'raw');
  }

  /** Throws when absent/empty; returns the narrowed file otherwise. */
  private assertFilePresent(file: UploadFile | undefined): UploadFile {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('file is required (multipart field "file")');
    }
    return file;
  }

  private async uploadToCloudinary(
    userId: string,
    file: UploadFile,
    resourceType: CloudinaryResourceType,
  ): Promise<UploadResult> {
    const creds: CloudinaryCredentials | null = await this.settings.getCloudinaryCredentials(userId);
    if (!creds) {
      throw new BadRequestException(
        'Cloudinary credentials are not configured — set them via PATCH /settings first',
      );
    }
    const result = await this.cloudinary.upload({
      buffer: file.buffer,
      filename: sanitizeFilename(file.originalname),
      mimetype: file.mimetype,
      resourceType,
      creds,
      folder: `codebot/${userId}`,
    });
    return { ...result, filename: sanitizeFilename(file.originalname) };
  }
}
