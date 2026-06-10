import { basename, extname } from 'node:path';
import { collectBlobListItems, type BlobListResponse } from './blob-list.js';
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

export type ReadableArtifactBlobStore = {
  get(key: string, options: { type: 'buffer' }): Promise<Buffer | ArrayBuffer | string | null>;
  list?: (options?: {
    prefix?: string;
    directories?: boolean;
    paginate?: boolean;
  }) => Promise<BlobListResponse> | AsyncIterable<BlobListResponse>;
};

export type WritableArtifactIndexStore = {
  setJSON?: (key: string, value: unknown, options?: { metadata?: Record<string, string> }) => Promise<unknown>;
};

export type ImageArtifactReconciliationResult =
  | { status: 'found'; blobKey: string; bytes: Buffer; correctedBlobKey?: string; nearbyKeys: string[] }
  | { status: 'missing'; blobKey: string; nearbyKeys: string[]; exactFilenameExists: boolean }
  | { status: 'ambiguous'; blobKey: string; matchingKeys: string[]; nearbyKeys: string[] };

const imageExtensionFallbacks = new Set(['jpg', 'jpeg', 'png', 'webp']);

const normalizeArtifactBlobKey = (blobKey: string) =>
  blobKey
    .trim()
    .replace(/^\/+/, '')
    .replace(/^artifacts\//, '');

const getBlobKeyPrefix = (blobKey: string) => {
  const parts = blobKey.split('/');
  if (parts.length < 3) return '';

  return `${parts[0]}/${parts[1]}/`;
};

const requestArtifactIndexKey = (requestId: string, sha256: string) => {
  return `request-artifacts/${encodeURIComponent(requestId)}/${sha256}.json`;
};

const toBufferOrNull = (value: Buffer | ArrayBuffer | string | null) => {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);

  return Buffer.from(value);
};

const tryReadArtifactBytes = async (store: ReadableArtifactBlobStore, key: string) => {
  try {
    return toBufferOrNull(await store.get(key, { type: 'buffer' }));
  } catch {
    return null;
  }
};

const uniqueValues = <T>(values: T[]) => [...new Set(values)];

const listImageArtifactKeysForPrefixes = async (store: ReadableArtifactBlobStore, prefixes: string[]) => {
  if (typeof store.list !== 'function') return [];

  const keys: string[] = [];

  for (const candidatePrefix of uniqueValues(prefixes.filter(Boolean))) {
    try {
      const result = await store.list({ prefix: candidatePrefix, directories: false, paginate: true });
      const items = await collectBlobListItems(result as BlobListResponse);
      keys.push(...items.map((item) => item.key));
    } catch {
      // Listing is diagnostic and best-effort. Keep reconciling with any prefixes that do work.
    }
  }

  return uniqueValues(keys).sort();
};

const getNearbyImageArtifactKeys = async (store: ReadableArtifactBlobStore, normalizedBlobKey: string) => {
  const prefix = getBlobKeyPrefix(normalizedBlobKey);
  if (!prefix) return [];

  return listImageArtifactKeysForPrefixes(store, [prefix, `artifacts/${prefix}`, `/${prefix}`]);
};

const getGlobalImageArtifactKeys = async (store: ReadableArtifactBlobStore) => {
  return listImageArtifactKeysForPrefixes(store, ['image/', 'artifacts/image/', '/image/']);
};

const getExtension = (filename: string) => filename.split('.').pop()?.toLowerCase() || '';

const stripExtension = (filename: string) => filename.replace(/\.[^.]+$/, '');

const getImageArtifactKeyMatches = (nearbyKeys: string[], normalizedBlobKey: string) => {
  const expectedFilename = basename(normalizedBlobKey);
  const expectedStem = stripExtension(expectedFilename);

  return nearbyKeys.filter((key) => {
    const candidateFilename = basename(key);
    if (candidateFilename === expectedFilename) return true;
    if (stripExtension(candidateFilename) !== expectedStem) return false;

    const expectedExtension = getExtension(expectedFilename);
    const candidateExtension = getExtension(candidateFilename);

    return imageExtensionFallbacks.has(expectedExtension) && imageExtensionFallbacks.has(candidateExtension);
  });
};

const maybeUpdateArtifactIndexReference = async (
  indexStore: WritableArtifactIndexStore | undefined,
  reference: ArtifactReference,
  correctedBlobKey: string
) => {
  const indexBlobKey = normalizeArtifactBlobKey(correctedBlobKey);
  if (
    !indexStore?.setJSON ||
    indexBlobKey === reference.blobKey ||
    !isValidArtifactBlobKey(indexBlobKey, reference.sha256)
  ) {
    return;
  }

  const [, requestId = ''] = indexBlobKey.split('/');
  if (!requestId) return;

  await indexStore.setJSON(
    requestArtifactIndexKey(requestId, reference.sha256),
    { ...reference, blobKey: indexBlobKey },
    {
      metadata: {
        requestId,
        sha256: reference.sha256,
        contentType: reference.contentType,
      },
    }
  );
};

export const getImageArtifactReadDiagnostics = async (
  store: ReadableArtifactBlobStore,
  blobKey: string,
  nearbyKeys?: string[]
) => {
  const normalizedBlobKey = normalizeArtifactBlobKey(blobKey);
  const keys = nearbyKeys ?? (await getNearbyImageArtifactKeys(store, normalizedBlobKey));
  const exactFilename = basename(normalizedBlobKey);

  return {
    normalizedBlobKey,
    parentPrefix: getBlobKeyPrefix(normalizedBlobKey),
    exactFilename,
    exactFilenameExists: keys.some((key) => basename(key) === exactFilename),
    nearbyKeys: keys.slice(0, 25),
  };
};

export const reconcileImageArtifactReference = async (
  reference: ArtifactReference,
  artifactStore: ReadableArtifactBlobStore,
  indexStore?: WritableArtifactIndexStore
): Promise<ImageArtifactReconciliationResult> => {
  const normalizedBlobKey = normalizeArtifactBlobKey(reference.blobKey);
  const directBytes = await tryReadArtifactBytes(artifactStore, normalizedBlobKey);

  if (directBytes) {
    await maybeUpdateArtifactIndexReference(indexStore, reference, normalizedBlobKey);

    return {
      status: 'found',
      blobKey: normalizedBlobKey,
      bytes: directBytes,
      correctedBlobKey: normalizedBlobKey === reference.blobKey ? undefined : normalizedBlobKey,
      nearbyKeys: [],
    };
  }

  const nearbyKeys = await getNearbyImageArtifactKeys(artifactStore, normalizedBlobKey);
  let matches = getImageArtifactKeyMatches(nearbyKeys, normalizedBlobKey);
  let searchedKeys = nearbyKeys;

  if (!matches.length) {
    const globalKeys = await getGlobalImageArtifactKeys(artifactStore);
    matches = getImageArtifactKeyMatches(globalKeys, normalizedBlobKey);
    searchedKeys = uniqueValues([...nearbyKeys, ...globalKeys]).sort();
  }

  if (matches.length === 1) {
    const correctedBlobKey = matches[0];
    const correctedBytes = await tryReadArtifactBytes(artifactStore, correctedBlobKey);

    if (correctedBytes) {
      await maybeUpdateArtifactIndexReference(indexStore, reference, correctedBlobKey);

      return {
        status: 'found',
        blobKey: correctedBlobKey,
        bytes: correctedBytes,
        correctedBlobKey: correctedBlobKey === reference.blobKey ? undefined : correctedBlobKey,
        nearbyKeys: searchedKeys,
      };
    }
  }

  const exactFilename = basename(normalizedBlobKey);

  if (matches.length > 1) {
    return { status: 'ambiguous', blobKey: normalizedBlobKey, matchingKeys: matches, nearbyKeys: searchedKeys };
  }

  return {
    status: 'missing',
    blobKey: normalizedBlobKey,
    nearbyKeys: searchedKeys,
    exactFilenameExists: searchedKeys.some((key) => basename(key) === exactFilename),
  };
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

const allowedArtifactReferenceKeys = new Set([
  'blobKey',
  'sizeBytes',
  'sha256',
  'contentType',
  'createdAtISO',
  'metadata',
]);

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

export const requireArtifactReferenceArray = (
  value: unknown,
  fieldName = 'artifactReferences'
): ArtifactReference[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array of ArtifactReference objects.`);

  return value.map((reference, index) => {
    const issue = getArtifactReferenceIssue(reference);
    if (issue) throw new Error(`${fieldName}[${index}] is not a valid ArtifactReference: ${issue}.`);

    return reference;
  });
};
