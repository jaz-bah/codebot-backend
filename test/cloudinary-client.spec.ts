import { createHash } from 'crypto';
import { BadGatewayException } from '@nestjs/common';
import { CloudinaryClient, cloudinarySignature } from '../src/modules/uploads/cloudinary-client';

const CREDS = { cloudName: 'test-cloud', apiKey: 'test-api-key', apiSecret: 'test-api-secret' };

const makeBuffer = (bytes: number[]): Buffer => Buffer.from(bytes);

describe('cloudinarySignature', () => {
  it('signs the sorted params with the secret appended (SHA-1), excluding api_key', () => {
    // Locks the exact concatenation contract: sorted keys, k=v, '&', + secret.
    // api_key is excluded per Cloudinary's signed-upload spec.
    const expected = createHash('sha1')
      .update(`folder=codebot/u1&timestamp=1700000000test-api-secret`)
      .digest('hex');
    expect(
      cloudinarySignature({ timestamp: '1700000000', folder: 'codebot/u1' }, 'test-api-secret'),
    ).toBe(expected);
  });
});

describe('CloudinaryClient.upload', () => {
  const client = new CloudinaryClient();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('POSTs a signed multipart request to the resource-type endpoint', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          secure_url: 'https://res.cloudinary.com/test-cloud/raw/upload/codebot/u1/a.zip',
          public_id: 'codebot/u1/a',
          resource_type: 'raw',
          format: 'zip',
          bytes: 1234,
        }),
        { status: 200 },
      ),
    );

    const result = await client.upload({
      buffer: makeBuffer([0x50, 0x4b, 0x03, 0x04, 0, 0]),
      filename: 'a.zip',
      mimetype: 'application/zip',
      resourceType: 'raw',
      creds: CREDS,
      folder: 'codebot/u1',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudinary.com/v1_1/test-cloud/raw/upload');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('api_key')).toBe('test-api-key');
    expect(form.get('folder')).toBe('codebot/u1');
    expect(typeof form.get('timestamp')).toBe('string');
    expect(form.get('signature')).toBe(
      cloudinarySignature(
        { folder: 'codebot/u1', timestamp: form.get('timestamp') as string },
        'test-api-secret',
      ),
    );
    const filePart = form.get('file');
    expect(filePart).toBeInstanceOf(Blob);
    // Result mapping
    expect(result).toMatchObject({
      url: 'https://res.cloudinary.com/test-cloud/raw/upload/codebot/u1/a.zip',
      publicId: 'codebot/u1/a',
      resourceType: 'raw',
      format: 'zip',
      bytes: 1234,
    });
  });

  it('uses the image endpoint for image uploads', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ secure_url: 'https://x/y.png', public_id: 'y', bytes: 10 }), { status: 200 }),
    );
    await client.upload({
      buffer: makeBuffer([0x89, 0x50, 0x4e, 0x47]),
      filename: 'y.png',
      mimetype: 'image/png',
      resourceType: 'image',
      creds: CREDS,
      folder: 'codebot/u1',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.cloudinary.com/v1_1/test-cloud/image/upload');
  });

  it('maps Cloudinary API errors to 502 with the upstream message', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }),
    );
    await expect(
      client.upload({
        buffer: makeBuffer([0x89, 0x50, 0x4e, 0x47]),
        filename: 'y.png',
        mimetype: 'image/png',
        resourceType: 'image',
        creds: CREDS,
        folder: 'codebot/u1',
      }),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining('Invalid API key') });
  });

  it('maps network failures to 502 (no stack/internal leak)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(
      client.upload({
        buffer: makeBuffer([0x50, 0x4b, 0x03, 0x04]),
        filename: 'a.zip',
        mimetype: 'application/zip',
        resourceType: 'raw',
        creds: CREDS,
        folder: 'codebot/u1',
      }),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('could not reach Cloudinary'),
    });
  });

  it('maps malformed success responses to 502', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
    await expect(
      client.upload({
        buffer: makeBuffer([0x50, 0x4b, 0x03, 0x04]),
        filename: 'a.zip',
        mimetype: 'application/zip',
        resourceType: 'raw',
        creds: CREDS,
        folder: 'codebot/u1',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
