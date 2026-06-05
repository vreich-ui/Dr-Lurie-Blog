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
