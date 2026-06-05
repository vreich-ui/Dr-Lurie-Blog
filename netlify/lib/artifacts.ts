import { extname } from 'node:path';
import { sha256Hex } from './crypto.js';

export enum ArtifactKind {
  Image = 'image',
  Audio = 'audio',
  Video = 'video',
  Binary = 'binary',
  Markdown = 'markdown',
}

export type ArtifactReference = {
  blobKey: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
  createdAtISO: string;
  metadata?: Record<string, unknown>;
};

export type ArtifactUploadInput = {
  requestId: string;
  artifactKind: ArtifactKind;
  contentType: string;
  filename?: string;
  chunkIndex?: number;
  totalChunks?: number;
  encoding?: 'base64' | 'binary';
  payload: string;
  metadata?: Record<string, unknown>;
};

type CreateArtifactReferenceOptions = {
  input: Pick<ArtifactUploadInput, 'artifactKind' | 'contentType' | 'filename' | 'metadata' | 'requestId'>;
  bytes: Buffer | Uint8Array;
  createdAtISO?: string;
};

const allowedArtifactReferenceKeys = new Set(['blobKey', 'sizeBytes', 'sha256', 'contentType', 'createdAtISO', 'metadata']);

const safePathSegment = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
};

export const getArtifactExtension = (filename: string | undefined): string => {
  if (!filename) return '';

  const extension = extname(filename)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');

  return extension.length > 1 ? extension : '';
};

export const createArtifactBlobKey = (input: {
  artifactKind: ArtifactKind;
  requestId: string;
  sha256: string;
  filename?: string;
}): string => {
  const requestId = safePathSegment(input.requestId) || 'request';
  const extension = getArtifactExtension(input.filename);

  return `${input.artifactKind}/${requestId}/${input.sha256}${extension}`;
};

export const createArtifactReference = ({
  input,
  bytes,
  createdAtISO = new Date().toISOString(),
}: CreateArtifactReferenceOptions): ArtifactReference => {
  const sha256 = sha256Hex(bytes);

  return {
    blobKey: createArtifactBlobKey({
      artifactKind: input.artifactKind,
      requestId: input.requestId,
      sha256,
      filename: input.filename,
    }),
    sizeBytes: bytes.byteLength,
    sha256,
    contentType: input.contentType,
    createdAtISO,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

export const isValidArtifactBlobKey = (blobKey: string, sha256: string): boolean => {
  const [kind, requestId, filename, ...extra] = blobKey.split('/');
  const validKinds = new Set(Object.values(ArtifactKind));

  return Boolean(
    !extra.length &&
      validKinds.has(kind as ArtifactKind) &&
      safePathSegment(requestId) === requestId &&
      requestId.length > 0 &&
      filename &&
      filename.startsWith(sha256) &&
      /^[a-f0-9]{64}(\.[a-z0-9]+)?$/i.test(filename)
  );
};

export const getArtifactReferenceIssue = (value: unknown): string | undefined => {
  if (!isRecord(value)) return 'expected an ArtifactReference object';

  const unexpectedKeys = Object.keys(value).filter((key) => !allowedArtifactReferenceKeys.has(key));
  if (unexpectedKeys.length) return `unexpected top-level keys: ${unexpectedKeys.join(', ')}`;

  const { blobKey, sizeBytes, sha256, contentType, createdAtISO, metadata } = value;
  if (typeof blobKey !== 'string' || !blobKey.trim()) return 'blobKey must be a non-empty string';
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) return 'sha256 must be a 64-character hex string';
  if (!isValidArtifactBlobKey(blobKey, sha256)) return 'blobKey must match the server ArtifactReference path format';
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return 'sizeBytes must be a non-negative number';
  }
  if (typeof contentType !== 'string' || !contentType.trim()) return 'contentType must be a non-empty string';
  if (typeof createdAtISO !== 'string' || Number.isNaN(Date.parse(createdAtISO))) {
    return 'createdAtISO must be a valid ISO date string';
  }
  if (metadata !== undefined && !isRecord(metadata)) return 'metadata must be an object when provided';

  return undefined;
};

export const isArtifactReference = (value: unknown): value is ArtifactReference => {
  return getArtifactReferenceIssue(value) === undefined;
};

export const requireArtifactReferenceArray = (value: unknown, fieldName = 'artifactReferences'): ArtifactReference[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array of ArtifactReference objects.`);

  return value.map((reference, index) => {
    const issue = getArtifactReferenceIssue(reference);
    if (issue) throw new Error(`${fieldName}[${index}] is not a valid ArtifactReference: ${issue}.`);

    return reference;
  });
};
