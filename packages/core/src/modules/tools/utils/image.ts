/**
 * Lightweight image MIME type detection.
 *
 * Reads only the file header (magic bytes) to detect image types,
 * avoiding the need for full image parsing libraries.
 */

import * as fs from 'fs/promises';

/** Magic byte signatures for common image formats */
const IMAGE_SIGNATURES: Array<{ mime: string; bytes: number[]; offset: number; mask?: number[] }> = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0 },
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF], offset: 0 },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], offset: 0 }, // GIF89a
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], offset: 0 }, // GIF87a
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },            // RIFF header
  { mime: 'image/bmp', bytes: [0x42, 0x4D], offset: 0 },                          // BM
  { mime: 'image/tiff', bytes: [0x49, 0x49, 0x2A, 0x00], offset: 0 },             // TIFF little-endian
  { mime: 'image/tiff', bytes: [0x4D, 0x4D, 0x00, 0x2A], offset: 0 },             // TIFF big-endian
  { mime: 'image/avif', bytes: [0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], offset: 0 },
  { mime: 'image/svg+xml', bytes: [0x3C, 0x73, 0x76, 0x67], offset: 0 },          // <svg
];

/** Read the first N bytes of a file for magic byte detection */
async function readFileHeader(filePath: string, numBytes: number): Promise<Buffer | null> {
  try {
    const fd = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(numBytes);
      const { bytesRead } = await fd.read(buffer, 0, numBytes, 0);
      return bytesRead > 0 ? buffer.subarray(0, bytesRead) : null;
    } finally {
      await fd.close();
    }
  } catch {
    return null;
  }
}

/**
 * Detect image MIME type from file header (magic bytes).
 * Returns null if the file is not a recognized image format.
 * Only reads the first ~64 bytes of the file — very lightweight.
 */
export async function detectImageMimeType(filePath: string): Promise<string | null> {
  const header = await readFileHeader(filePath, 64);
  if (!header) return null;

  // WebP needs special handling: check RIFF + WEBP
  if (
    header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46
  ) {
    // Check for WEBP at offset 8
    if (
      header.length >= 12 &&
      header[8] === 0x57 && header[9] === 0x45 &&
      header[10] === 0x42 && header[11] === 0x50
    ) {
      return 'image/webp';
    }
    // Not a WEBP RIFF
    return null;
  }

  for (const sig of IMAGE_SIGNATURES) {
    if (sig.mime === 'image/webp') continue; // handled above

    if (header.length < sig.offset + sig.bytes.length) continue;

    let match = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      const byteIndex = sig.offset + i;
      if (byteIndex >= header.length) {
        match = false;
        break;
      }
      const expected = sig.bytes[i];
      const actual = header[byteIndex];
      const mask = sig.mask?.[i];
      if (mask !== undefined) {
        if ((actual & mask) !== (expected & mask)) {
          match = false;
          break;
        }
      } else if (actual !== expected) {
        match = false;
        break;
      }
    }

    if (match) return sig.mime;
  }

  return null;
}

/**
 * File extension to MIME type mapping (fallback when magic bytes don't match).
 */
export function getImageMimeFromExtension(filePath: string): string | null {
  const ext = filePath.toLowerCase().split('.').pop();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    ico: 'image/x-icon',
  };
  return ext ? (map[ext] ?? null) : null;
}
