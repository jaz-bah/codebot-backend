import { createHash } from 'crypto';
import { BadGatewayException } from '@nestjs/common';
import type { CloudinaryCredentials } from './cloudinary-credentials';

/**
 * Minimal signed Cloudinary REST upload client — uses Node's global
 * `fetch`/`FormData`/`Blob` and `crypto` (no SDK dependency).
 *
 * Signature: SHA-1 over the alphabetically sorted `key=value` pairs joined by
 * `&`, with the API secret appended (Cloudinary's signed-upload spec).
 * Per that spec the signature covers every sent param EXCEPT `file`,
 * `api_key`, `cloud_name` and `resource_type` — so here that's exactly
 * `folder` + `timestamp`.
 */
const CLOUDINARY_UPLOAD_BASE = 'https://api.cloudinary.com/v1_1';
const UPLOAD_TIMEOUT_MS = 30_000;

export type CloudinaryResourceType = 'image' | 'raw';

export interface CloudinaryUploadInput {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  resourceType: CloudinaryResourceType;
  creds: CloudinaryCredentials;
  /** Destination folder in the user's Cloudinary media library. */
  folder: string;
}

export interface CloudinaryUploadResult {
  url: string;
  publicId: string;
  resourceType: string;
  format: string | null;
  bytes: number;
}

/** Cloudinary signed-upload signature (sorted params + secret, SHA-1). */
export const cloudinarySignature = (params: Record<string, string>, apiSecret: string): string =>
  createHash('sha1')
    .update(
      Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&') + apiSecret,
    )
    .digest('hex');

interface CloudinaryApiResponse {
  secure_url?: string;
  public_id?: string;
  resource_type?: string;
  format?: string;
  bytes?: number;
  error?: { message?: string };
}

export class CloudinaryClient {
  async upload(input: CloudinaryUploadInput): Promise<CloudinaryUploadResult> {
    const { buffer, filename, mimetype, resourceType, creds, folder } = input;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    // api_key is sent in the form but MUST NOT be signed (Cloudinary spec:
    // signature covers folder + timestamp, packet excludes file/api_key).
    const signature = cloudinarySignature({ folder, timestamp }, creds.apiSecret);

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimetype }), filename);
    form.append('api_key', creds.apiKey);
    form.append('timestamp', timestamp);
    form.append('folder', folder);
    form.append('signature', signature);

    let response: Response;
    try {
      response = await fetch(`${CLOUDINARY_UPLOAD_BASE}/${encodeURIComponent(creds.cloudName)}/${resourceType}/upload`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch {
      throw new BadGatewayException('Cloudinary upload failed: could not reach Cloudinary');
    }

    const json = (await response.json().catch(() => ({}))) as CloudinaryApiResponse;
    if (!response.ok) {
      const detail = json.error?.message ?? `HTTP ${response.status}`;
      throw new BadGatewayException(`Cloudinary upload failed: ${detail}`);
    }
    if (!json.secure_url || !json.public_id) {
      throw new BadGatewayException('Cloudinary upload failed: unexpected response from Cloudinary');
    }
    return {
      url: json.secure_url,
      publicId: json.public_id,
      resourceType: json.resource_type ?? resourceType,
      format: json.format ?? null,
      bytes: json.bytes ?? buffer.byteLength,
    };
  }
}
