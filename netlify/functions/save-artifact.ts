/**
 * Function name: Save_Artifact
 * Required method: POST
 * Required header: x-publish-key
 * Stores:
 * - artifacts: final binary artifact bytes and temporary upload chunks
 * - artifact-index: JSON request artifact reference indexes
 */
import { timingSafeEqual } from 'node:crypto';

import sharp from 'sharp';
import { z } from 'zod';

import {
  ArtifactKind,
  createArtifactReference,
  isArtifactReference,
  type ArtifactReference,
  type ArtifactUploadInput,
} from '../lib/artifacts.js';
import { getHeader } from '../lib/admin-auth.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore } from '../lib/blob-store.js';
import { sha256Hex } from '../lib/crypto.js';

// artifactStore holds binary blobs (final artifacts and temporary chunks); indexStore holds JSON references and indexes.

type LambdaEvent = {
  blobs?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  isBase64Encoded?: boolean;
};

type UploadRequest = ArtifactUploadInput & {
  clientUploadId?: string;
  expectedSizeBytes?: number;
  expectedSha256?: string;
  localSizeBytes?: number;
  localSha256?: string;
};

type ChunkStatus = {
  complete: boolean;
  receivedChunks: number;
  totalChunks: number;
};

type ChunkManifest = {
  requestId: string;
  clientUploadId: string;
  totalChunks: number;
  artifactKind: ArtifactKind;
  contentType: string;
  filename?: string;
  expectedSizeBytes?: number;
  expectedSha256?: string;
  receivedChunkIndexes: number[];
  chunkDigests: Record<string, { sizeBytes: number; sha256: string }>;
  updatedAtISO: string;
};

type BlobStore = Awaited<ReturnType<typeof getArtifactBlobStore>>;
type BinaryReadableBlobStore = Omit<BlobStore, 'get'> & {
  get: (key: string, options: { type: 'arrayBuffer' }) => Promise<ArrayBuffer | null>;
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const uploadSchema = z
  .object({
    requestId: z.string().min(1),
    artifactKind: z.enum(ArtifactKind),
    contentType: z.string().min(1),
    filename: z.string().min(1).optional(),
    clientUploadId: z.uuid().optional(),
    chunkIndex: z.number().int().nonnegative().optional(),
    totalChunks: z.number().int().positive().max(10_000).optional(),
    encoding: z.enum(['base64', 'binary']).optional(),
    expectedSizeBytes: z.number().int().nonnegative().optional(),
    expectedSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    localSizeBytes: z.number().int().nonnegative().optional(),
    localSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    payload: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasChunkIndex = value.chunkIndex !== undefined;
    const hasTotalChunks = value.totalChunks !== undefined;

    if (hasChunkIndex !== hasTotalChunks) {
      context.addIssue({
        code: 'custom',
        path: hasChunkIndex ? ['totalChunks'] : ['chunkIndex'],
        message: 'chunkIndex and totalChunks must be supplied together.',
      });
    }

    if (hasChunkIndex && !value.clientUploadId) {
      context.addIssue({
        code: 'custom',
        path: ['clientUploadId'],
        message: 'clientUploadId is required for chunked uploads.',
      });
    }

    if (
      value.expectedSizeBytes !== undefined &&
      value.localSizeBytes !== undefined &&
      value.expectedSizeBytes !== value.localSizeBytes
    ) {
      context.addIssue({
        code: 'custom',
        path: ['localSizeBytes'],
        message: 'localSizeBytes must match expectedSizeBytes when both are supplied.',
      });
    }

    if (
      value.expectedSha256 !== undefined &&
      value.localSha256 !== undefined &&
      value.expectedSha256.toLowerCase() !== value.localSha256.toLowerCase()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['localSha256'],
        message: 'localSha256 must match expectedSha256 when both are supplied.',
      });
    }

    if (value.chunkIndex !== undefined && value.totalChunks !== undefined && value.chunkIndex >= value.totalChunks) {
      context.addIssue({
        code: 'custom',
        path: ['chunkIndex'],
        message: 'chunkIndex must be less than totalChunks.',
      });
    }
  });

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify(body),
});

const parseBody = (event: LambdaEvent): unknown => {
  if (!event.body) return undefined;

  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  return JSON.parse(body) as unknown;
};

const secretsMatch = (provided: string, expected: string) => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
};

const verifyPublishKey = (event: LambdaEvent) => {
  const provided = getHeader(event.headers, 'x-publish-key');
  const expected = process.env.NETLIFY_PUBLISH_SECRET || process.env.PUBLISH_SECRET || '';

  if (!provided || !expected || !secretsMatch(provided, expected)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  return undefined;
};

const decodePayload = (input: Pick<UploadRequest, 'encoding' | 'payload'>) => {
  if (input.encoding === 'binary') return Buffer.from(input.payload, 'binary');

  return Buffer.from(input.payload, 'base64');
};

const getExpectedSizeBytes = (input: UploadRequest) => input.expectedSizeBytes ?? input.localSizeBytes;

const getExpectedSha256 = (input: UploadRequest) => input.expectedSha256 ?? input.localSha256;

const validateArtifactIntegrity = (input: UploadRequest, bytes: Buffer) => {
  const sizeBytes = bytes.byteLength;
  const sha256 = sha256Hex(bytes);
  const expectedSizeBytes = getExpectedSizeBytes(input);
  const expectedSha256 = getExpectedSha256(input);

  if (expectedSizeBytes !== undefined && expectedSizeBytes !== sizeBytes) {
    return jsonResponse(400, {
      error: `Artifact size mismatch: expected ${expectedSizeBytes} bytes, received ${sizeBytes} bytes.`,
    });
  }

  if (expectedSha256 !== undefined && expectedSha256.toLowerCase() !== sha256) {
    return jsonResponse(400, {
      error: `Artifact sha256 mismatch: expected ${expectedSha256}, received ${sha256}.`,
    });
  }

  return undefined;
};

const isJpegContentType = (contentType: string) => {
  const normalized = contentType.split(';', 1)[0].trim().toLowerCase();

  return normalized === 'image/jpeg' || normalized === 'image/jpg';
};

const validateImageArtifact = async (input: UploadRequest, bytes: Buffer) => {
  if (!isJpegContentType(input.contentType)) return undefined;

  const hasJpegMarkers =
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9;

  if (!hasJpegMarkers) {
    return jsonResponse(400, { error: 'Invalid JPEG artifact: missing SOI or EOI marker.' });
  }

  try {
    await sharp(bytes).metadata();
  } catch {
    return jsonResponse(400, { error: 'Invalid JPEG artifact: image bytes could not be decoded.' });
  }

  return undefined;
};

const validateFinalArtifact = async (input: UploadRequest, bytes: Buffer) => {
  const integrityError = validateArtifactIntegrity(input, bytes);

  if (integrityError) return integrityError;

  return validateImageArtifact(input, bytes);
};

const chunkUploadPrefix = (requestId: string, clientUploadId: string) => {
  return `artifact-chunks/${requestId}/${clientUploadId}/`;
};

const chunkKey = (requestId: string, clientUploadId: string, chunkIndex: number) => {
  return `${chunkUploadPrefix(requestId, clientUploadId)}${chunkIndex}`;
};

const chunkManifestKey = (requestId: string, clientUploadId: string) => {
  return `${chunkUploadPrefix(requestId, clientUploadId)}manifest.json`;
};

const requestArtifactIndexKey = (requestId: string, sha256: string) => {
  return `request-artifacts/${encodeURIComponent(requestId)}/${sha256}.json`;
};

const getArrayBuffer = async (store: BlobStore, key: string) => {
  const binaryStore = store as BinaryReadableBlobStore;
  const value = await binaryStore.get(key, { type: 'arrayBuffer' });

  return value ? Buffer.from(value) : null;
};

const chunkStatusCache = new Map<string, number>();

const chunkStatusCacheKey = (requestId: string, clientUploadId: string) => `${requestId}:${clientUploadId}`;

const toValidChunkIndexSet = (indexes: unknown, totalChunks: number) => {
  if (!Array.isArray(indexes)) return new Set<number>();

  return new Set(
    indexes.filter((index): index is number => Number.isInteger(index) && index >= 0 && index < totalChunks)
  );
};

const readChunkManifestRecord = async (store: BlobStore, requestId: string, clientUploadId: string) => {
  const manifest = await store.get(chunkManifestKey(requestId, clientUploadId));

  if (!manifest) return undefined;

  try {
    const parsed = JSON.parse(manifest) as unknown;

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Partial<ChunkManifest>)
      : undefined;
  } catch {
    return undefined;
  }
};

const readChunkManifest = async (store: BlobStore, requestId: string, clientUploadId: string, totalChunks: number) => {
  const parsed = await readChunkManifestRecord(store, requestId, clientUploadId);

  return toValidChunkIndexSet(parsed?.receivedChunkIndexes, totalChunks);
};

const validateChunkUploadManifest = async (
  store: BlobStore,
  input: Required<Pick<UploadRequest, 'requestId' | 'clientUploadId' | 'chunkIndex' | 'totalChunks'>> & UploadRequest,
  bytes: Buffer
) => {
  const parsed = await readChunkManifestRecord(store, input.requestId, input.clientUploadId);

  if (!parsed) return undefined;

  if (parsed.totalChunks !== undefined && parsed.totalChunks !== input.totalChunks) {
    return jsonResponse(400, {
      error: `Chunk upload totalChunks mismatch for clientUploadId ${input.clientUploadId}: expected existing total ${parsed.totalChunks}, received ${input.totalChunks}.`,
    });
  }

  const expectedSizeBytes = getExpectedSizeBytes(input);
  const expectedSha256 = getExpectedSha256(input)?.toLowerCase();
  const manifestExpectedSha256 = parsed.expectedSha256?.toLowerCase();
  const mismatches = [
    parsed.artifactKind !== undefined && parsed.artifactKind !== input.artifactKind
      ? `artifactKind expected ${parsed.artifactKind} received ${input.artifactKind}`
      : undefined,
    parsed.contentType !== undefined && parsed.contentType !== input.contentType
      ? `contentType expected ${parsed.contentType} received ${input.contentType}`
      : undefined,
    parsed.filename !== undefined && parsed.filename !== input.filename
      ? `filename expected ${parsed.filename} received ${input.filename ?? ''}`
      : undefined,
    parsed.expectedSizeBytes !== undefined &&
    expectedSizeBytes !== undefined &&
    parsed.expectedSizeBytes !== expectedSizeBytes
      ? `expectedSizeBytes expected ${parsed.expectedSizeBytes} received ${expectedSizeBytes}`
      : undefined,
    manifestExpectedSha256 !== undefined && expectedSha256 !== undefined && manifestExpectedSha256 !== expectedSha256
      ? `expectedSha256 expected ${manifestExpectedSha256} received ${expectedSha256}`
      : undefined,
  ].filter(Boolean);

  if (mismatches.length) {
    return jsonResponse(400, {
      error: `Chunk upload metadata mismatch for clientUploadId ${input.clientUploadId}: ${mismatches.join('; ')}.`,
    });
  }

  const existingChunkDigest = parsed.chunkDigests?.[String(input.chunkIndex)];
  const incomingChunkDigest = { sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) };

  if (
    existingChunkDigest &&
    (existingChunkDigest.sizeBytes !== incomingChunkDigest.sizeBytes ||
      existingChunkDigest.sha256.toLowerCase() !== incomingChunkDigest.sha256)
  ) {
    return jsonResponse(400, {
      error: `Chunk upload digest mismatch for clientUploadId ${input.clientUploadId} chunkIndex ${input.chunkIndex}.`,
    });
  }

  return undefined;
};

const writeChunkManifest = async (
  store: BlobStore,
  input: Required<Pick<UploadRequest, 'requestId' | 'clientUploadId' | 'chunkIndex' | 'totalChunks'>> & UploadRequest,
  receivedChunkIndexes: Set<number>,
  bytes: Buffer
) => {
  const existingManifest = await readChunkManifestRecord(store, input.requestId, input.clientUploadId);
  const expectedSizeBytes = getExpectedSizeBytes(input);
  const expectedSha256 = getExpectedSha256(input)?.toLowerCase();
  const manifest: ChunkManifest = {
    requestId: input.requestId,
    clientUploadId: input.clientUploadId,
    totalChunks: input.totalChunks,
    artifactKind: input.artifactKind,
    contentType: input.contentType,
    ...(input.filename ? { filename: input.filename } : {}),
    ...(expectedSizeBytes !== undefined ? { expectedSizeBytes } : {}),
    ...(expectedSha256 ? { expectedSha256 } : {}),
    receivedChunkIndexes: [...receivedChunkIndexes].sort((a, b) => a - b),
    chunkDigests: {
      ...(existingManifest?.chunkDigests ?? {}),
      [String(input.chunkIndex)]: { sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes) },
    },
    updatedAtISO: new Date().toISOString(),
  };

  await store.setJSON(chunkManifestKey(input.requestId, input.clientUploadId), manifest, {
    metadata: {
      requestId: input.requestId,
      clientUploadId: input.clientUploadId,
      totalChunks: String(input.totalChunks),
      receivedChunks: String(manifest.receivedChunkIndexes.length),
    },
  });
};

const getVisibleChunkIndexes = async (
  store: BlobStore,
  requestId: string,
  clientUploadId: string,
  totalChunks: number
) => {
  const receivedChunkIndexes = new Set<number>();

  // Intentionally avoid prefix listing because list visibility can lag behind recent writes in Netlify Blob runtime.
  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = await getArrayBuffer(store, chunkKey(requestId, clientUploadId, index));

    if (chunk) receivedChunkIndexes.add(index);
  }

  return receivedChunkIndexes;
};

const toChunkStatus = (
  requestId: string,
  clientUploadId: string,
  totalChunks: number,
  receivedChunkIndexes: Set<number>
): ChunkStatus => {
  const cacheKey = chunkStatusCacheKey(requestId, clientUploadId);
  const previousReceivedChunks = chunkStatusCache.get(cacheKey) ?? 0;
  const receivedChunks = Math.min(totalChunks, Math.max(previousReceivedChunks, receivedChunkIndexes.size));

  chunkStatusCache.set(cacheKey, receivedChunks);

  return {
    complete: receivedChunks === totalChunks,
    receivedChunks,
    totalChunks,
  };
};

export const saveUploadedChunk = async (
  store: BlobStore,
  requestId: string,
  clientUploadId: string,
  chunkIndex: number,
  totalChunks: number,
  bytes: Buffer,
  uploadInput?: Required<Pick<UploadRequest, 'requestId' | 'clientUploadId' | 'chunkIndex' | 'totalChunks'>> &
    UploadRequest
): Promise<ChunkStatus> => {
  await store.set(chunkKey(requestId, clientUploadId, chunkIndex), bytes, {
    metadata: {
      requestId,
      clientUploadId,
      chunkIndex: String(chunkIndex),
      totalChunks: String(totalChunks),
    },
  });

  const [manifestChunkIndexes, visibleChunkIndexes] = await Promise.all([
    readChunkManifest(store, requestId, clientUploadId, totalChunks),
    getVisibleChunkIndexes(store, requestId, clientUploadId, totalChunks),
  ]);
  const receivedChunkIndexes = new Set([...manifestChunkIndexes, ...visibleChunkIndexes, chunkIndex]);

  await writeChunkManifest(
    store,
    uploadInput ?? {
      requestId,
      clientUploadId,
      chunkIndex,
      totalChunks,
      artifactKind: ArtifactKind.Binary,
      contentType: 'application/octet-stream',
      payload: '',
    },
    receivedChunkIndexes,
    bytes
  );

  return toChunkStatus(requestId, clientUploadId, totalChunks, receivedChunkIndexes);
};

const mergeChunkManifestIntegrity = async (
  store: BlobStore,
  input: Required<Pick<UploadRequest, 'requestId' | 'clientUploadId' | 'chunkIndex' | 'totalChunks'>> & UploadRequest
): Promise<UploadRequest> => {
  const manifest = await readChunkManifestRecord(store, input.requestId, input.clientUploadId);

  if (!manifest) return input;

  return {
    ...input,
    expectedSizeBytes: input.expectedSizeBytes ?? input.localSizeBytes ?? manifest.expectedSizeBytes,
    expectedSha256: input.expectedSha256 ?? input.localSha256 ?? manifest.expectedSha256,
  };
};

const assembleChunks = async (store: BlobStore, requestId: string, clientUploadId: string, totalChunks: number) => {
  const chunks: Buffer[] = [];

  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = await getArrayBuffer(store, chunkKey(requestId, clientUploadId, index));

    if (!chunk) return null;

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
};

const waitForStoredBytesRetry = (attemptIndex: number) => {
  const baseDelayMs = 25 * 2 ** attemptIndex;
  const jitterMs = Math.floor(Math.random() * 10);

  return new Promise((resolve) => setTimeout(resolve, baseDelayMs + jitterMs));
};

const readStoredBytes = async (store: BlobStore, key: string, options: { retry?: boolean } = {}) => {
  const maxAttempts = options.retry === false ? 1 : 5;

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    const storedBytes = await getArrayBuffer(store, key);

    if (storedBytes) return storedBytes;
    if (attemptIndex < maxAttempts - 1) await waitForStoredBytesRetry(attemptIndex);
  }

  return null;
};

const validateStoredBytes = async (store: BlobStore, reference: ArtifactReference) => {
  const storedBytes = await readStoredBytes(store, reference.blobKey);

  if (!storedBytes) {
    return jsonResponse(500, { error: 'Artifact blob write failed: stored bytes could not be read back.' });
  }

  const storedSizeBytes = storedBytes.byteLength;
  const storedSha256 = sha256Hex(storedBytes);

  if (storedSizeBytes !== reference.sizeBytes || storedSha256 !== reference.sha256) {
    await store.del(reference.blobKey);

    return jsonResponse(500, {
      error: `Artifact blob write failed integrity verification: expected ${reference.sizeBytes} bytes/${reference.sha256}, stored ${storedSizeBytes} bytes/${storedSha256}.`,
    });
  }

  return undefined;
};

const saveFinalArtifact = async (store: BlobStore, reference: ArtifactReference, bytes: Buffer) => {
  if (await readStoredBytes(store, reference.blobKey, { retry: false })) {
    const existingIntegrityError = await validateStoredBytes(store, reference);

    if (existingIntegrityError) return { deduped: true, integrityError: existingIntegrityError };

    return { deduped: true };
  }

  await store.set(reference.blobKey, bytes, {
    onlyIfNew: true,
    metadata: {
      contentType: reference.contentType,
      sha256: reference.sha256,
      sizeBytes: String(reference.sizeBytes),
      createdAtISO: reference.createdAtISO,
    },
  });

  const integrityError = await validateStoredBytes(store, reference);

  return { deduped: false, integrityError };
};

const getExistingReference = async (store: BlobStore, requestId: string, sha256: string) => {
  const existing = await store.get(requestArtifactIndexKey(requestId, sha256));

  if (!existing) return undefined;

  try {
    const parsed = JSON.parse(existing) as unknown;

    return isArtifactReference(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const saveReference = async (store: BlobStore, requestId: string, reference: ArtifactReference) => {
  await store.setJSON(requestArtifactIndexKey(requestId, reference.sha256), reference, {
    metadata: {
      requestId,
      sha256: reference.sha256,
      contentType: reference.contentType,
    },
  });
};

const finalizeUpload = async (
  event: LambdaEvent,
  input: UploadRequest,
  finalBytes: Buffer,
  chunkStatus?: ChunkStatus
) => {
  const validationError = await validateFinalArtifact(input, finalBytes);

  if (validationError) return validationError;

  const artifactStore = await getArtifactBlobStore(event);
  const indexStore = await getArtifactIndexBlobStore(event);
  const reference = createArtifactReference({ input, bytes: finalBytes });
  const { deduped, integrityError } = await saveFinalArtifact(artifactStore, reference, finalBytes);

  if (integrityError) return integrityError;

  const existingReference = deduped
    ? await getExistingReference(indexStore, input.requestId, reference.sha256)
    : undefined;
  const responseReference = existingReference ?? reference;

  if (!existingReference) {
    await saveReference(indexStore, input.requestId, responseReference);
  }

  return jsonResponse(deduped ? 200 : 201, {
    ok: true,
    complete: true,
    deduped,
    artifact: responseReference,
    ...(chunkStatus ? { receivedChunks: chunkStatus.receivedChunks, totalChunks: chunkStatus.totalChunks } : {}),
  });
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const unauthorized = verifyPublishKey(event);

  if (unauthorized) return unauthorized;

  let parsedBody: unknown;

  try {
    parsedBody = parseBody(event);
  } catch {
    return jsonResponse(400, { error: 'Invalid request body' });
  }

  const parsedInput = uploadSchema.safeParse(parsedBody);

  if (!parsedInput.success) {
    return jsonResponse(400, { error: 'Invalid artifact upload input', issues: parsedInput.error.issues });
  }

  const input = parsedInput.data;
  const bytes = decodePayload(input);

  if (input.chunkIndex === undefined || input.totalChunks === undefined || !input.clientUploadId) {
    return finalizeUpload(event, input, bytes);
  }

  const chunkInput = {
    ...input,
    clientUploadId: input.clientUploadId,
    chunkIndex: input.chunkIndex,
    totalChunks: input.totalChunks,
  } as Required<Pick<UploadRequest, 'requestId' | 'clientUploadId' | 'chunkIndex' | 'totalChunks'>> & UploadRequest;
  const artifactStore = await getArtifactBlobStore(event);
  const chunkManifestValidationError = await validateChunkUploadManifest(artifactStore, chunkInput, bytes);

  if (chunkManifestValidationError) return chunkManifestValidationError;

  const status = await saveUploadedChunk(
    artifactStore,
    chunkInput.requestId,
    chunkInput.clientUploadId,
    chunkInput.chunkIndex,
    chunkInput.totalChunks,
    bytes,
    chunkInput
  );

  if (!status.complete) {
    return jsonResponse(202, {
      ok: true,
      complete: false,
      receivedChunks: status.receivedChunks,
      totalChunks: status.totalChunks,
    });
  }

  const assembledBytes = await assembleChunks(
    artifactStore,
    chunkInput.requestId,
    chunkInput.clientUploadId,
    chunkInput.totalChunks
  );

  if (!assembledBytes) {
    return jsonResponse(202, {
      ok: true,
      complete: false,
      receivedChunks: status.receivedChunks,
      totalChunks: status.totalChunks,
    });
  }

  const finalInput = await mergeChunkManifestIntegrity(artifactStore, chunkInput);

  return finalizeUpload(event, finalInput, assembledBytes, status);
};
