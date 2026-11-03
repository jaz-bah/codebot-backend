import { UploadsService } from '../src/modules/uploads/uploads.service';
import type { CloudinaryUploadResult } from '../src/modules/uploads/cloudinary-client';
import type { UploadFile } from '../src/modules/uploads/multer-file.interceptor';

/**
 * UploadsService unit tests — magic-byte validation, size caps, credential
 * gating and Cloudinary orchestration, against fakes (no real uploads).
 */

const makeFile = (bytes: number[] | Buffer, name = 'upload.bin', size?: number): UploadFile =>
  ({
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    buffer: Array.isArray(bytes) ? Buffer.from(bytes) : bytes,
    size: size ?? (Array.isArray(bytes) ? bytes.length : bytes.byteLength),
  }) as unknown as UploadFile;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(16).fill(0)];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, ...new Array<number>(16).fill(0)];
const GIF = [...Buffer.from('GIF89a'), 0, 0, 0, 0, ...new Array<number>(16).fill(0)];
const WEBP = [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), ...new Array<number>(8).fill(0)];
const ZIP = [0x50, 0x4b, 0x03, 0x04, ...new Array<number>(16).fill(0)];
const TEXT = [...Buffer.from('definitely not an image or zip file, just plain text')];

const CREDS = { cloudName: 'my-cloud', apiKey: 'key-123', apiSecret: 'secret-456' };
const CLIENT_RESULT: CloudinaryUploadResult = {
  url: 'https://res.cloudinary.com/my-cloud/image/upload/x.png',
  publicId: 'x',
  resourceType: 'image',
  format: 'png',
  bytes: 24,
};

const makeService = (creds: typeof CREDS | null = CREDS) => {
  const settings = { getCloudinaryCredentials: jest.fn().mockResolvedValue(creds) };
  const cloudinary = { upload: jest.fn().mockResolvedValue(CLIENT_RESULT) };
  const svc = new UploadsService(settings as never, cloudinary as never);
  return { svc, settings, cloudinary };
};

describe('UploadsService — uploadImage', () => {
  it('accepts png/jpeg/gif/webp by MAGIC BYTES and routes to the image endpoint', async () => {
    for (const [bytes, kind] of [
      [PNG, 'png'],
      [JPEG, 'jpeg'],
      [GIF, 'gif'],
      [WEBP, 'webp'],
    ] as Array<[number[], string]>) {
      const { svc, cloudinary, settings } = makeService();
      const result = await svc.uploadImage('u1', makeFile(bytes, `photo.${kind}`));
      expect(settings.getCloudinaryCredentials).toHaveBeenCalledWith('u1');
      expect(cloudinary.upload).toHaveBeenCalledTimes(1);
      expect(cloudinary.upload.mock.calls[0][0]).toMatchObject({
        resourceType: 'image',
        folder: 'codebot/u1',
        creds: CREDS,
      });
      expect(result.url).toBe(CLIENT_RESULT.url);
      expect(result.resourceType).toBe('image');
    }
  });

  it('rejects non-image content regardless of filename/mimetype', async () => {
    const { svc, cloudinary } = makeService();
    await expect(svc.uploadImage('u1', makeFile(TEXT, 'fake.png', TEXT.length))).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('does not look like a supported image'),
    });
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });

  it('rejects images over the 10 MB cap with 413', async () => {
    const { svc, cloudinary } = makeService();
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    await expect(svc.uploadImage('u1', makeFile(big, 'big.png'))).rejects.toMatchObject({ status: 413 });
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });

  it('rejects a missing/empty file with 400', async () => {
    const { svc } = makeService();
    await expect(svc.uploadImage('u1', undefined)).rejects.toMatchObject({ status: 400 });
    await expect(svc.uploadImage('u1', makeFile([], 'empty.png', 0))).rejects.toMatchObject({ status: 400 });
  });
});

describe('UploadsService — uploadZip', () => {
  it('accepts zip magic bytes and routes to the raw endpoint', async () => {
    const { svc, cloudinary } = makeService();
    const result = await svc.uploadZip('u1', makeFile(ZIP, 'archive.zip'));
    expect(cloudinary.upload.mock.calls[0][0]).toMatchObject({ resourceType: 'raw', folder: 'codebot/u1' });
    expect(result.url).toBe(CLIENT_RESULT.url);
  });

  it('rejects non-zip content with 400', async () => {
    const { svc, cloudinary } = makeService();
    await expect(svc.uploadZip('u1', makeFile(TEXT, 'fake.zip'))).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('does not look like a zip archive'),
    });
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });

  it('rejects zips over the 50 MB cap with 413', async () => {
    const { svc, cloudinary } = makeService();
    const big = Buffer.alloc(50 * 1024 * 1024 + 1, 0x50);
    await expect(svc.uploadZip('u1', makeFile(big, 'big.zip'))).rejects.toMatchObject({ status: 413 });
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });
});

describe('UploadsService — credential gating', () => {
  it('400 with a helpful message when Cloudinary credentials are not configured', async () => {
    const { svc, cloudinary } = makeService(null);
    await expect(svc.uploadImage('u1', makeFile(PNG, 'ok.png'))).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Cloudinary credentials are not configured'),
    });
    await expect(svc.uploadZip('u1', makeFile(ZIP, 'ok.zip'))).rejects.toMatchObject({ status: 400 });
    expect(cloudinary.upload).not.toHaveBeenCalled();
  });

  it('propagates Cloudinary failures (e.g. 502) untouched', async () => {
    const { svc, cloudinary } = makeService();
    cloudinary.upload.mockRejectedValue(Object.assign(new Error('Cloudinary upload failed: Invalid API key'), { status: 502 }));
    await expect(svc.uploadImage('u1', makeFile(PNG, 'ok.png'))).rejects.toMatchObject({ status: 502 });
  });

  it('scopes the upload folder (and credential lookup) to the requesting user', async () => {
    const { svc, cloudinary, settings } = makeService();
    await svc.uploadImage('user-42', makeFile(PNG, 'ok.png'));
    expect(settings.getCloudinaryCredentials).toHaveBeenCalledWith('user-42');
    expect(cloudinary.upload.mock.calls[0][0].folder).toBe('codebot/user-42');
  });

  it('sanitizes hostile filenames before they reach Cloudinary', async () => {
    const { svc, cloudinary } = makeService();
    await svc.uploadImage('u1', makeFile(PNG, '..\\..\\evil name<>?.png'));
    // path stripped, runs of invalid chars collapse to a single underscore
    expect(cloudinary.upload.mock.calls[0][0].filename).toBe('evil_name_.png');
  });
});
