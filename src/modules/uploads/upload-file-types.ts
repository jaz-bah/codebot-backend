/**
 * Upload validation helpers: file-type detection by MAGIC BYTES (never trust
 * the client-supplied mimetype/filename), size caps, and filename sanitizing.
 */

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const ZIP_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export type ImageKind = 'jpeg' | 'png' | 'gif' | 'webp';

/** Detects an image kind from magic bytes; null when unrecognized. */
export const detectImageKind = (buffer: Buffer): ImageKind | null => {
  if (buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  // GIF: "GIF8"
  if (buffer.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  // WEBP: "RIFF" + "WEBP" at offset 8
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'webp';
  }
  return null;
};

/** ZIP local-file header / empty archive / spanned marker — all start "PK". */
export const looksLikeZip = (buffer: Buffer): boolean => {
  if (buffer.length < 4) return false;
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  const sig = (buffer[2] << 8) | buffer[3];
  return sig === 0x0304 || sig === 0x0506 || sig === 0x0708;
};

/** Cloudinary-safe filename: basename only, restricted charset, bounded length. */
export const sanitizeFilename = (raw: string): string => {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  const capped = (cleaned || 'upload').slice(0, 120);
  return capped === '.' || capped === '..' ? 'upload' : capped;
};
