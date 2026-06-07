/**
 * Function name: Save_Artifact
 * Required method: POST
 * Required header: x-publish-key
 * Stores:
 * - artifacts: final binary artifact bytes and temporary upload chunks
 * - artifact-index: JSON request artifact reference indexes
 */
import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import {
  ArtifactKind,
  createArtifactReference,
  isArtifactReference,
  type ArtifactReference,
  type ArtifactUploadInput,
} from '../lib/artifacts.js';
import { getHeader } from '../lib/admin-auth.js';
import { collectBlobListItems } from '../lib/blob-list.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore } from '../lib/blob-store.js';

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
};

type ChunkStatus = {
  complete: boolean;
  receivedChunks: number;
  totalChunks: number;
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

const chunkUploadPrefix = (requestId: string, clientUploadId: string) => {
  return `artifact-chunks/${requestId}/${clientUploadId}/`;
};

const chunkKey = (requestId: string, clientUploadId: string, chunkIndex: number) => {
  return `${chunkUploadPrefix(requestId, clientUploadId)}${chunkIndex}`;
};

const requestArtifactIndexKey = (requestId: string, sha256: string) => {
  return `request-artifacts/${encodeURIComponent(requestId)}/${sha256}.json`;
};

const getChunkStatus = async (
  store: BlobStore,
  requestId: string,
  clientUploadId: string,
  totalChunks: number
): Promise<ChunkStatus> => {
  const prefix = chunkUploadPrefix(requestId, clientUploadId);
  const items = await collectBlobListItems(await store.list({ prefix }));
  const chunkIndexPattern = /^\d+$/;
  const receivedChunks = items.filter((blob) => {
    if (!blob.key.startsWith(prefix)) return false;

    const relativeKey = blob.key.slice(prefix.length);

    return chunkIndexPattern.test(relativeKey);
  }).length;

  return {
    complete: receivedChunks === totalChunks,
    receivedChunks,
    totalChunks,
  };
};

const getArrayBuffer = async (store: BlobStore, key: string) => {
  const binaryStore = store as BinaryReadableBlobStore;
  const value = await binaryStore.get(key, { type: 'arrayBuffer' });

  return value ? Buffer.from(value) : null;
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

const blobExists = async (store: BlobStore, key: string) => {
  return (await store.get(key)) !== null;
};

const saveFinalArtifact = async (store: BlobStore, reference: ArtifactReference, bytes: Buffer) => {
  if (await blobExists(store, reference.blobKey)) return { deduped: true };

  await store.set(reference.blobKey, bytes, {
    onlyIfNew: true,
    metadata: {
      contentType: reference.contentType,
      sha256: reference.sha256,
      createdAtISO: reference.createdAtISO,
    },
  });

  return { deduped: false };
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

const finalizeUpload = async (event: LambdaEvent, input: UploadRequest, bytes: Buffer, chunkStatus?: ChunkStatus) => {
  const artifactStore = await getArtifactBlobStore(event);
  const indexStore = await getArtifactIndexBlobStore(event);
  const reference = createArtifactReference({ input, bytes });
  const { deduped } = await saveFinalArtifact(artifactStore, reference, bytes);
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

  const artifactStore = await getArtifactBlobStore(event);
  const indexStore = await getArtifactIndexBlobStore(event);

  // Keep indexStore initialized in this branch for parity with single-shot finalization, but chunk bytes live in artifactStore.
  void indexStore;

  await artifactStore.set(chunkKey(input.requestId, input.clientUploadId, input.chunkIndex), bytes, {
    metadata: {
      requestId: input.requestId,
      clientUploadId: input.clientUploadId,
      chunkIndex: String(input.chunkIndex),
      totalChunks: String(input.totalChunks),
    },
  });

  const status = await getChunkStatus(artifactStore, input.requestId, input.clientUploadId, input.totalChunks);

  if (!status.complete) {
    return jsonResponse(202, {
      ok: true,
      complete: false,
      receivedChunks: status.receivedChunks,
      totalChunks: status.totalChunks,
    });
  }

  const assembledBytes = await assembleChunks(artifactStore, input.requestId, input.clientUploadId, input.totalChunks);

  if (!assembledBytes) {
    return jsonResponse(202, {
      ok: true,
      complete: false,
      receivedChunks: status.receivedChunks,
      totalChunks: status.totalChunks,
    });
  }

  return finalizeUpload(event, input, assembledBytes, status);
};
