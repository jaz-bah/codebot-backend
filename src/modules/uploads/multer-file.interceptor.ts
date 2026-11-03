import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

/**
 * Multer is already present as a transitive dependency of
 * @nestjs/platform-express; requiring it directly adds NO new dependency.
 * `@types/multer` is not installed, so multer is typed as `any` here and the
 * uploaded file is described by our own minimal `UploadedFile` interface.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const multerFactory: any = require('multer');

/** Minimal shape of a memory-storage multipart file (multer contract). */
export interface UploadFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * Single-file multipart interceptor backed by multer memoryStorage (the
 * dependency-free alternative to Nest's FileInterceptor, which requires
 * @types/multer typings). The raw buffer lands on `req.file` and is validated
 * downstream (magic bytes + size) by UploadsService.
 *
 * Error mapping mirrors Nest's FileInterceptor: multer LIMIT_FILE_SIZE → 413,
 * everything else → 400.
 */
@Injectable()
export class MulterSingleFileInterceptor implements NestInterceptor {
  private readonly upload: (req: unknown, res: unknown, cb: (err?: unknown) => void) => void;
  private readonly maxBytes: number;

  constructor(fieldName: string, maxBytes: number) {
    this.maxBytes = maxBytes;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    this.upload = (multerFactory as any)({
      storage: multerFactory.memoryStorage(),
      limits: { fileSize: maxBytes, files: 1 },
    }).single(fieldName);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest();
    await new Promise<void>((resolve, reject) => {
      this.upload(request, context.switchToHttp().getResponse(), (err?: unknown) => {
        if (!err) {
          resolve();
          return;
        }
        const code = (err as { code?: string }).code;
        if (code === 'LIMIT_FILE_SIZE') {
          reject(new PayloadTooLargeException(`file exceeds the ${this.maxBytes} byte limit`));
        } else {
          reject(new BadRequestException(`upload failed: ${(err as Error).message ?? 'malformed multipart body'}`));
        }
      });
    });
    return next.handle();
  }
}

/** Per-route factory (each route gets its own multer instance + size cap). */
export const singleFileUpload = (fieldName: string, maxBytes: number): MulterSingleFileInterceptor =>
  new MulterSingleFileInterceptor(fieldName, maxBytes);
