import path from 'node:path';

import type sharpType from 'sharp';

// sharp's native libvips binding dominates cold-start module evaluation for
// every function that bundles this file (the /mcp endpoint included, via
// save-artifact and artifact-upload). Loading it on first image validation
// instead of at import keeps initialize/tools/list and all non-image tool
// calls off that cost. Cached per runtime instance.
let cachedSharp: typeof sharpType | undefined;

const loadSharp = async (): Promise<typeof sharpType> => {
  if (!cachedSharp) {
    cachedSharp = (await import('sharp')).default;
  }
  return cachedSharp;
};

const supportedFormats = new Set(['jpeg', 'png', 'webp']);

const formatLabels: Record<string, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
};

const extensionFormats: Record<string, string> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
};

const contentTypeFormats: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export class ImageValidationError extends Error {
  code: 'invalid-image-bytes' | 'missing-image-dimensions' | 'image-type-mismatch';
  imageName: string;
  path: string;
  reason: string;

  constructor({
    code,
    imageName,
    path,
    reason,
  }: {
    code: ImageValidationError['code'];
    imageName: string;
    path: string;
    reason: string;
  }) {
    super(`Invalid image artifact: ${imageName} ${reason}. Re-upload or replace this image.`);
    this.name = 'ImageValidationError';
    this.code = code;
    this.imageName = imageName;
    this.path = path;
    this.reason = reason;
  }
}

const normalizeContentType = (contentType: string | undefined) => contentType?.toLowerCase().split(';')[0]?.trim();

const getExpectedFormats = ({ path: repoPath, contentType }: { path: string; contentType?: string }) => {
  const extensionFormat = extensionFormats[path.extname(repoPath).toLowerCase()];
  const normalizedContentType = normalizeContentType(contentType);
  const contentTypeFormat = normalizedContentType ? contentTypeFormats[normalizedContentType] : undefined;

  return { contentTypeFormat, extensionFormat, normalizedContentType };
};

const formatLabel = (format: string | undefined) => (format ? (formatLabels[format] ?? format.toUpperCase()) : 'image');

export const validatePublishImageBytes = async ({
  bytes,
  contentType,
  filename,
  path: repoPath,
}: {
  bytes: Buffer;
  contentType?: string;
  filename?: string;
  path: string;
}) => {
  const imageName = filename || repoPath;
  const { contentTypeFormat, extensionFormat, normalizedContentType } = getExpectedFormats({
    path: repoPath,
    contentType,
  });
  const expectedFormat = extensionFormat ?? contentTypeFormat;

  let metadata: sharpType.Metadata;

  if (normalizedContentType && !contentTypeFormat) {
    throw new ImageValidationError({
      code: 'image-type-mismatch',
      imageName,
      path: repoPath,
      reason: `declared unsupported content type ${normalizedContentType}`,
    });
  }

  // Loaded outside the decode try/catch: a broken sharp install must surface
  // as the raw module error (as it did when this was a top-level import),
  // never be misreported as invalid image bytes.
  const sharp = await loadSharp();

  try {
    metadata = await sharp(bytes, { failOn: 'error' }).metadata();
  } catch {
    throw new ImageValidationError({
      code: 'invalid-image-bytes',
      imageName,
      path: repoPath,
      reason: `could not be decoded as a valid ${formatLabel(expectedFormat)}`,
    });
  }

  const decodedFormat = metadata.format;

  if (!metadata.width || metadata.width <= 0 || !metadata.height || metadata.height <= 0 || !decodedFormat) {
    throw new ImageValidationError({
      code: 'missing-image-dimensions',
      imageName,
      path: repoPath,
      reason: `could not be decoded as a valid ${formatLabel(expectedFormat)}`,
    });
  }

  if (!supportedFormats.has(decodedFormat)) {
    throw new ImageValidationError({
      code: 'image-type-mismatch',
      imageName,
      path: repoPath,
      reason: `decoded as unsupported ${formatLabel(decodedFormat)} bytes`,
    });
  }

  if (extensionFormat && decodedFormat !== extensionFormat) {
    throw new ImageValidationError({
      code: 'image-type-mismatch',
      imageName,
      path: repoPath,
      reason: `could not be decoded as a valid ${formatLabel(extensionFormat)}`,
    });
  }

  if (contentTypeFormat && decodedFormat !== contentTypeFormat) {
    throw new ImageValidationError({
      code: 'image-type-mismatch',
      imageName,
      path: repoPath,
      reason: `declared ${normalizedContentType} but decoded as ${formatLabel(decodedFormat)} bytes`,
    });
  }

  if (!extensionFormat && !contentTypeFormat) {
    throw new ImageValidationError({
      code: 'image-type-mismatch',
      imageName,
      path: repoPath,
      reason: 'must use a supported JPEG, PNG, or WebP upload type',
    });
  }

  return metadata;
};
