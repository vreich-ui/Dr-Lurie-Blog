import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { isArtifactReference } from '../lib/artifacts.js';
import { collectBlobListItems, type BlobListResult } from '../lib/blob-list.js';
import {
  getArtifactBlobStore,
  getArtifactIndexBlobStore,
  getCoreBlobStoreSourceDiagnostics,
} from '../lib/blob-store.js';

const allowedImageBlobKeyPattern = /^image\/[a-z0-9._-]+\/[a-f0-9]{64}(?:\.[a-z0-9]+)?$/i;
const contentTypeByExtension: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

type LambdaEvent = {
  blobs?: string;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
};

type BinaryReadableArtifactBlobStore = Awaited<ReturnType<typeof getArtifactBlobStore>> & {
  get(key: string, options: { type: 'buffer' }): Promise<Buffer | ArrayBuffer | string | null>;
};

type ArtifactIndexBlobStore = Awaited<ReturnType<typeof getArtifactIndexBlobStore>> & {
  list?: (options?: {
    prefix?: string;
    directories?: boolean;
    paginate?: boolean;
  }) => Promise<BlobListResult> | AsyncIterable<BlobListResult>;
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const toText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const getConcreteImageContentType = (value: unknown) => {
  const normalized = toText(value).toLowerCase().split(';')[0]?.trim() || '';
  if (!/^image\/[a-z0-9.+-]+$/.test(normalized) || normalized === 'image/*') return '';

  return normalized;
};

const getContentTypeFromExtension = (blobKey: string) => {
  const extension = blobKey.split('.').pop()?.toLowerCase() || '';
  return contentTypeByExtension[extension] || '';
};

type ContentTypeSource = 'artifact-index' | 'query-string' | 'extension' | 'missing';

type ResolvedArtifactContentType = {
  contentType: string;
  source: ContentTypeSource;
};

const createArtifactDebugFields = (
  event: LambdaEvent,
  blobKey: string,
  contentTypeSource: ContentTypeSource = 'missing',
  extra: Record<string, unknown> = {}
) => ({
  blobKey,
  store: 'artifacts',
  lookup: 'bytes',
  contentTypeSource,
  blobStoreDiagnostics: getCoreBlobStoreSourceDiagnostics(event),
  ...extra,
});

const getShaFromBlobKey = (blobKey: string) => {
  const [, , filename = ''] = blobKey.split('/');
  const match = filename.match(/^[a-f0-9]{64}/i);

  return match?.[0]?.toLowerCase() || '';
};

const getRequestIdFromBlobKey = (blobKey: string) => {
  const [, requestId = ''] = blobKey.split('/');

  return requestId.trim();
};

const loadArtifactReference = async (store: ArtifactIndexBlobStore, key: string) => {
  const raw = await store.get(key);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as unknown;

    return isArtifactReference(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const findArtifactReferenceByBlobKey = async (store: ArtifactIndexBlobStore, blobKey: string) => {
  const requestId = getRequestIdFromBlobKey(blobKey);
  const sha = getShaFromBlobKey(blobKey);
  const directIndexKey = requestId && sha ? `request-artifacts/${encodeURIComponent(requestId)}/${sha}.json` : '';

  if (directIndexKey) {
    const directReference = await loadArtifactReference(store, directIndexKey);
    if (directReference?.blobKey === blobKey) return directReference;
  }

  if (typeof store.list !== 'function') return undefined;

  const result = await store.list({ prefix: 'request-artifacts/', directories: false, paginate: true });
  const blobs = await collectBlobListItems(result);

  for (const blob of blobs) {
    if (!blob.key.endsWith('.json') || blob.key === directIndexKey) continue;

    const reference = await loadArtifactReference(store, blob.key);
    if (reference?.blobKey === blobKey) return reference;
  }

  return undefined;
};

const resolveArtifactContentType = async (
  event: LambdaEvent,
  blobKey: string
): Promise<ResolvedArtifactContentType> => {
  try {
    const indexStore = (await getArtifactIndexBlobStore(event)) as ArtifactIndexBlobStore;
    const reference = await findArtifactReferenceByBlobKey(indexStore, blobKey);
    const indexedContentType = getConcreteImageContentType(reference?.contentType);
    if (indexedContentType) return { contentType: indexedContentType, source: 'artifact-index' };
  } catch (error) {
    console.warn('Artifact index lookup failed while resolving image content type.', { blobKey, error });
  }

  const queryContentType = getConcreteImageContentType(event.queryStringParameters?.contentType);
  if (queryContentType) return { contentType: queryContentType, source: 'query-string' };

  const extensionContentType = getContentTypeFromExtension(blobKey);
  if (extensionContentType) return { contentType: extensionContentType, source: 'extension' };

  return { contentType: '', source: 'missing' };
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const adminState = await getAdminStateFromEvent(event);
  if (!adminState.authenticated) {
    return jsonResponse(adminState.error === 'Clerk authentication is not configured.' ? 500 : 401, {
      error: adminState.error || 'A valid Clerk session token is required.',
    });
  }

  if (!adminState.isAdmin) {
    return jsonResponse(403, { error: 'This Clerk user is not authorized to read saved image artifacts.' });
  }

  const blobKey = toText(event.queryStringParameters?.blobKey);
  if (!allowedImageBlobKeyPattern.test(blobKey)) {
    return jsonResponse(400, {
      error: 'A valid image artifact blobKey is required.',
      ...createArtifactDebugFields(event, blobKey),
    });
  }

  let contentTypeSource: ContentTypeSource = 'missing';

  try {
    const resolvedContentType = await resolveArtifactContentType(event, blobKey);
    const { contentType } = resolvedContentType;
    contentTypeSource = resolvedContentType.source;
    if (!contentType) {
      return jsonResponse(400, {
        error: 'A concrete image content type is required for this artifact.',
        ...createArtifactDebugFields(event, blobKey, contentTypeSource),
      });
    }

    const store = (await getArtifactBlobStore(event)) as BinaryReadableArtifactBlobStore;
    const bytes = await store.get(blobKey, { type: 'buffer' });

    if (!bytes)
      return jsonResponse(404, {
        error: 'Image artifact was not found.',
        ...createArtifactDebugFields(event, blobKey, contentTypeSource),
      });
    if (typeof bytes === 'string')
      return jsonResponse(500, {
        error: 'Image artifact returned text instead of bytes.',
        ...createArtifactDebugFields(event, blobKey, contentTypeSource, { actualValueType: 'string' }),
      });

    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error('Failed to read saved image artifact.', error);

    return jsonResponse(500, {
      error: 'Saved image artifact could not be read.',
      ...createArtifactDebugFields(event, blobKey, contentTypeSource),
    });
  }
};
