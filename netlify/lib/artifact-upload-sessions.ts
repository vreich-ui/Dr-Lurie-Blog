import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import {
  ArtifactKind,
  artifactKindValues,
  artifactReferenceLimits,
  isSafeArtifactFilename,
  isSafeArtifactText,
  safePathSegment,
  type ArtifactReference,
  type ArtifactUploadInput,
} from './artifacts.js';
import { getArtifactBlobStore } from './blob-store.js';
import { sha256Hex } from './crypto.js';

export const UPLOAD_SESSION_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
export const UPLOAD_SESSION_MAX_BYTES = 50 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export type ArtifactUploadSessionManifest = {
  sessionId: string;
  requestId: string;
  artifactKind: ArtifactKind;
  contentType: string;
  filename?: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  label?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  tokenSha256: string;
  chunkSizeBytes: number;
  maxBytes: number;
  expiresAtISO: string;
  createdAtISO: string;
  updatedAtISO: string;
  totalChunks?: number;
  receivedChunkIndexes: number[];
  chunkDigests: Record<string, { sizeBytes: number; sha256: string }>;
  finalizedArtifact?: ArtifactReference;
  finalizedAtISO?: string;
};

export type CreateUploadSessionInput = {
  requestId: string;
  artifactKind: ArtifactKind;
  contentType: string;
  filename?: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  label?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type FinalizeUploadSessionInput = CreateUploadSessionInput & {
  sessionId: string;
};

const safeArtifactFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(artifactReferenceLimits.originalFilename)
  .refine((value) => isSafeArtifactFilename(value), {
    message: 'filename must not contain control characters, angle brackets, or path separators.',
  });

const safeArtifactLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(artifactReferenceLimits.label)
  .refine((value) => isSafeArtifactText(value, artifactReferenceLimits.label), {
    message: 'label must not contain control characters or angle brackets.',
  });

const safeArtifactTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(artifactReferenceLimits.tag)
  .refine((value) => isSafeArtifactText(value, artifactReferenceLimits.tag), {
    message: 'tags must not contain control characters or angle brackets.',
  });

const createUploadSessionSchema = z
  .object({
    requestId: z.string().min(1),
    artifactKind: z.enum(artifactKindValues),
    contentType: z.string().min(1),
    filename: safeArtifactFilenameSchema.optional(),
    expectedSizeBytes: z.number().int().nonnegative().max(UPLOAD_SESSION_MAX_BYTES),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i),
    label: safeArtifactLabelSchema.optional(),
    tags: z.array(safeArtifactTagSchema).max(artifactReferenceLimits.tags).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const finalizeUploadSessionSchema = createUploadSessionSchema.extend({
  sessionId: z.uuid(),
});

export const parseCreateUploadSessionInput = (input: unknown): CreateUploadSessionInput =>
  createUploadSessionSchema.parse(input) as CreateUploadSessionInput;

export const parseFinalizeUploadSessionInput = (input: unknown): FinalizeUploadSessionInput =>
  finalizeUploadSessionSchema.parse(input) as FinalizeUploadSessionInput;

export const uploadSessionManifestKey = (sessionId: string) => `artifact-upload-sessions/${sessionId}/manifest.json`;
export const uploadSessionChunkPrefix = (sessionId: string) => `artifact-upload-sessions/${sessionId}/chunks/`;
export const uploadSessionChunkKey = (sessionId: string, chunkIndex: number) =>
  `${uploadSessionChunkPrefix(sessionId)}${chunkIndex}`;

const toArrayBufferBuffer = (value: Buffer | ArrayBuffer | string | null) => {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return Buffer.from(value);
};

export const getUploadSessionBaseUrl = () => '/.netlify/functions/save-artifact-upload-chunk';

export const createUploadSession = async (event: unknown, rawInput: unknown) => {
  const input = parseCreateUploadSessionInput(rawInput);
  const sessionId = randomUUID();
  const uploadToken = randomBytes(24).toString('base64url');
  const nowISO = new Date().toISOString();
  const manifest: ArtifactUploadSessionManifest = {
    sessionId,
    requestId: input.requestId,
    artifactKind: input.artifactKind,
    contentType: input.contentType,
    ...(input.filename ? { filename: input.filename } : {}),
    expectedSizeBytes: input.expectedSizeBytes,
    expectedSha256: input.expectedSha256.toLowerCase(),
    ...(input.label ? { label: input.label } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    tokenSha256: sha256Hex(Buffer.from(uploadToken)),
    chunkSizeBytes: UPLOAD_SESSION_CHUNK_SIZE_BYTES,
    maxBytes: UPLOAD_SESSION_MAX_BYTES,
    expiresAtISO: new Date(Date.now() + UPLOAD_SESSION_TTL_MS).toISOString(),
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    receivedChunkIndexes: [],
    chunkDigests: {},
  };

  const store = await getArtifactBlobStore(event);
  await store.setJSON(uploadSessionManifestKey(sessionId), manifest, {
    metadata: {
      sessionId,
      requestId: input.requestId,
      artifactKind: input.artifactKind,
      expectedSizeBytes: String(input.expectedSizeBytes),
      expectedSha256: input.expectedSha256.toLowerCase(),
    },
  });

  return {
    sessionId,
    uploadUrlBase: getUploadSessionBaseUrl(),
    uploadToken,
    chunkSizeBytes: UPLOAD_SESSION_CHUNK_SIZE_BYTES,
    maxBytes: UPLOAD_SESSION_MAX_BYTES,
  };
};

export const readUploadSessionManifest = async (event: unknown, sessionId: string) => {
  const store = await getArtifactBlobStore(event);
  const text = await store.get(uploadSessionManifestKey(sessionId));
  if (!text) return undefined;
  const parsed = JSON.parse(text) as unknown;
  return parsed as ArtifactUploadSessionManifest;
};

const secureEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

const validateManifestActive = (manifest: ArtifactUploadSessionManifest) => {
  if (manifest.finalizedArtifact)
    return { ok: false as const, statusCode: 409, error: 'Upload session is already finalized.' };
  if (Date.parse(manifest.expiresAtISO) <= Date.now()) {
    return { ok: false as const, statusCode: 410, error: 'Upload session has expired.' };
  }
  return { ok: true as const };
};

export const storeUploadSessionChunk = async ({
  event,
  sessionId,
  uploadToken,
  chunkIndex,
  totalChunks,
  bytes,
}: {
  event: unknown;
  sessionId: string;
  uploadToken: string;
  chunkIndex: number;
  totalChunks: number;
  bytes: Buffer;
}) => {
  const store = await getArtifactBlobStore(event);
  const manifest = await readUploadSessionManifest(event, sessionId);
  if (!manifest) return { statusCode: 404, body: { error: 'Upload session not found.' } };

  const active = validateManifestActive(manifest);
  if (!active.ok) return { statusCode: active.statusCode, body: { error: active.error } };

  const tokenSha256 = sha256Hex(Buffer.from(uploadToken));
  if (!secureEqual(tokenSha256, manifest.tokenSha256)) {
    return { statusCode: 401, body: { error: 'Invalid upload token.' } };
  }

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !Number.isInteger(totalChunks) || totalChunks < 1) {
    return { statusCode: 400, body: { error: 'Invalid chunk index or total chunks.' } };
  }
  if (chunkIndex >= totalChunks)
    return { statusCode: 400, body: { error: 'chunkIndex must be less than totalChunks.' } };
  if (bytes.byteLength > manifest.chunkSizeBytes) {
    return { statusCode: 413, body: { error: `Chunk exceeds maximum size of ${manifest.chunkSizeBytes} bytes.` } };
  }
  const expectedTotalChunks = Math.max(1, Math.ceil(manifest.expectedSizeBytes / manifest.chunkSizeBytes));
  if (totalChunks !== expectedTotalChunks) {
    return {
      statusCode: 400,
      body: { error: `totalChunks must be ${expectedTotalChunks} for this upload session.` },
    };
  }
  if (manifest.totalChunks !== undefined && manifest.totalChunks !== totalChunks) {
    return { statusCode: 400, body: { error: 'totalChunks does not match the existing upload session manifest.' } };
  }

  const incomingDigest = { sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) };
  const existingDigest = manifest.chunkDigests[String(chunkIndex)];
  if (
    existingDigest &&
    (existingDigest.sizeBytes !== incomingDigest.sizeBytes ||
      existingDigest.sha256.toLowerCase() !== incomingDigest.sha256)
  ) {
    return { statusCode: 409, body: { error: 'Chunk digest mismatch for existing chunk.' } };
  }

  if (!existingDigest) await store.set(uploadSessionChunkKey(sessionId, chunkIndex), bytes);

  const receivedChunkIndexes = new Set(manifest.receivedChunkIndexes);
  receivedChunkIndexes.add(chunkIndex);
  const updatedManifest: ArtifactUploadSessionManifest = {
    ...manifest,
    totalChunks,
    receivedChunkIndexes: [...receivedChunkIndexes].sort((a, b) => a - b),
    chunkDigests: { ...manifest.chunkDigests, [String(chunkIndex)]: incomingDigest },
    updatedAtISO: new Date().toISOString(),
  };
  await store.setJSON(uploadSessionManifestKey(sessionId), updatedManifest, {
    metadata: {
      sessionId,
      requestId: manifest.requestId,
      artifactKind: manifest.artifactKind,
      totalChunks: String(totalChunks),
      receivedChunks: String(updatedManifest.receivedChunkIndexes.length),
    },
  });

  return {
    statusCode: existingDigest ? 200 : 202,
    body: {
      ok: true,
      complete: updatedManifest.receivedChunkIndexes.length === totalChunks,
      receivedChunks: updatedManifest.receivedChunkIndexes.length,
      totalChunks,
    },
  };
};

const getChunkBytes = async (event: unknown, sessionId: string, chunkIndex: number) => {
  const store = await getArtifactBlobStore(event);
  return toArrayBufferBuffer(
    await (
      store as typeof store & {
        get: (key: string, options: { type: 'arrayBuffer' }) => Promise<ArrayBuffer | Buffer | null>;
      }
    ).get(uploadSessionChunkKey(sessionId, chunkIndex), { type: 'arrayBuffer' })
  );
};

const assertFinalizeInputMatchesManifest = (
  input: FinalizeUploadSessionInput,
  manifest: ArtifactUploadSessionManifest
): string | undefined => {
  const mismatches = [
    input.requestId !== manifest.requestId ? 'requestId does not match upload session.' : undefined,
    input.artifactKind !== manifest.artifactKind ? 'artifactKind does not match upload session.' : undefined,
    input.contentType !== manifest.contentType ? 'contentType does not match upload session.' : undefined,
    (input.filename ?? '') !== (manifest.filename ?? '') ? 'filename does not match upload session.' : undefined,
    input.expectedSizeBytes !== manifest.expectedSizeBytes
      ? 'expectedSizeBytes does not match upload session.'
      : undefined,
    input.expectedSha256.toLowerCase() !== manifest.expectedSha256.toLowerCase()
      ? 'expectedSha256 does not match upload session.'
      : undefined,
  ].filter(Boolean);

  return mismatches[0];
};

export const assembleUploadSessionBytes = async (event: unknown, manifest: ArtifactUploadSessionManifest) => {
  const totalChunks =
    manifest.totalChunks ?? Math.max(1, Math.ceil(manifest.expectedSizeBytes / manifest.chunkSizeBytes));
  const chunks: Buffer[] = [];

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const chunk = await getChunkBytes(event, manifest.sessionId, chunkIndex);
    if (!chunk) return { ok: false as const, error: `Upload session is missing chunk ${chunkIndex}.` };

    const digest = manifest.chunkDigests[String(chunkIndex)];
    const actualDigest = { sizeBytes: chunk.byteLength, sha256: sha256Hex(chunk) };
    if (!digest || digest.sizeBytes !== actualDigest.sizeBytes || digest.sha256 !== actualDigest.sha256) {
      return { ok: false as const, error: `Upload session chunk ${chunkIndex} failed integrity verification.` };
    }
    chunks.push(chunk);
  }

  return { ok: true as const, bytes: Buffer.concat(chunks) };
};

export const getFinalizeUploadSessionPayload = async (event: unknown, rawInput: unknown) => {
  const input = parseFinalizeUploadSessionInput(rawInput);
  const manifest = await readUploadSessionManifest(event, input.sessionId);
  if (!manifest) return { ok: false as const, statusCode: 404, error: 'Upload session not found.' };

  if (manifest.finalizedArtifact) {
    return { ok: true as const, alreadyFinalized: true, manifest, artifact: manifest.finalizedArtifact };
  }
  if (Date.parse(manifest.expiresAtISO) <= Date.now()) {
    return { ok: false as const, statusCode: 410, error: 'Upload session has expired.' };
  }

  const mismatch = assertFinalizeInputMatchesManifest(input, manifest);
  if (mismatch) return { ok: false as const, statusCode: 400, error: mismatch };

  const totalChunks = Math.max(1, Math.ceil(manifest.expectedSizeBytes / manifest.chunkSizeBytes));
  if (manifest.receivedChunkIndexes.length !== totalChunks) {
    return { ok: false as const, statusCode: 409, error: 'Upload session is incomplete.' };
  }

  const assembled = await assembleUploadSessionBytes(event, manifest);
  if (!assembled.ok) return { ok: false as const, statusCode: 409, error: assembled.error };

  return {
    ok: true as const,
    alreadyFinalized: false,
    manifest,
    bytes: assembled.bytes,
    uploadInput: {
      requestId: manifest.requestId,
      artifactKind: manifest.artifactKind,
      contentType: manifest.contentType,
      filename: manifest.filename,
      expectedSizeBytes: manifest.expectedSizeBytes,
      expectedSha256: manifest.expectedSha256,
      payload: '',
      label: manifest.label,
      tags: manifest.tags,
      metadata: manifest.metadata,
    } satisfies ArtifactUploadInput & { expectedSizeBytes: number; expectedSha256: string },
  };
};

export const markUploadSessionFinalized = async (
  event: unknown,
  manifest: ArtifactUploadSessionManifest,
  artifact: ArtifactReference
) => {
  const store = await getArtifactBlobStore(event);
  const updatedManifest: ArtifactUploadSessionManifest = {
    ...manifest,
    finalizedArtifact: artifact,
    finalizedAtISO: new Date().toISOString(),
    updatedAtISO: new Date().toISOString(),
  };
  await store.setJSON(uploadSessionManifestKey(manifest.sessionId), updatedManifest, {
    metadata: {
      sessionId: manifest.sessionId,
      requestId: manifest.requestId,
      artifactKind: manifest.artifactKind,
      finalized: 'true',
    },
  });
};

export const getUploadSessionSafeRequestSegment = (requestId: string) => safePathSegment(requestId) || 'request';
