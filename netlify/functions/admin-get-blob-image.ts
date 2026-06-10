import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import {
  getImageArtifactReadDiagnostics,
  isArtifactReference,
  reconcileImageArtifactReference,
  type ArtifactReference,
} from '../lib/artifacts.js';
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

const shouldIncludeArtifactReadDiagnostics = () => process.env.CONTEXT !== 'production';

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
  blobKey: string,
  reference?: ArtifactReference
): Promise<ResolvedArtifactContentType> => {
  try {
    let indexedContentType = getConcreteImageContentType(reference?.contentType);
    if (!indexedContentType) {
      const indexStore = (await getArtifactIndexBlobStore(event)) as ArtifactIndexBlobStore;
      reference = await findArtifactReferenceByBlobKey(indexStore, blobKey);
      indexedContentType = getConcreteImageContentType(reference?.contentType);
    }
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
    const indexStore = (await getArtifactIndexBlobStore(event)) as ArtifactIndexBlobStore;
    const indexedReference = await findArtifactReferenceByBlobKey(indexStore, blobKey);
    const resolvedContentType = await resolveArtifactContentType(event, blobKey, indexedReference);
    const { contentType } = resolvedContentType;
    contentTypeSource = resolvedContentType.source;
    if (!contentType) {
      return jsonResponse(400, {
        error: 'A concrete image content type is required for this artifact.',
        ...createArtifactDebugFields(event, blobKey, contentTypeSource),
      });
    }

    const reference: ArtifactReference = indexedReference ?? {
      blobKey,
      sha256: getShaFromBlobKey(blobKey),
      sizeBytes: 0,
      contentType,
      createdAtISO: new Date(0).toISOString(),
    };
    const store = await getArtifactBlobStore(event);
    const reconciliation = await reconcileImageArtifactReference(
      reference,
      store,
      indexedReference ? indexStore : undefined
    );

    if (reconciliation.status === 'missing') {
      const diagnostics = await getImageArtifactReadDiagnostics(store, blobKey, reconciliation.nearbyKeys);
      console.warn('Saved image artifact JSON reference is stale: backing bytes are missing.', {
        blobKey,
        store: 'artifacts',
        exactFilenameExists: diagnostics.exactFilenameExists,
        nearbyKeys: diagnostics.nearbyKeys,
      });

      return jsonResponse(404, {
        ...createArtifactDebugFields(event, blobKey, contentTypeSource),
        reason: 'missing-artifact-bytes',
        blobKey,
        store: 'artifacts',
        ...(shouldIncludeArtifactReadDiagnostics() ? { diagnostics } : {}),
      });
    }

    if (reconciliation.status === 'ambiguous') {
      console.warn('Saved image artifact recovery found multiple possible backing blobs.', {
        blobKey,
        store: 'artifacts',
        matchingKeys: reconciliation.matchingKeys,
        nearbyKeys: reconciliation.nearbyKeys,
      });

      return jsonResponse(409, {
        ...createArtifactDebugFields(event, blobKey, contentTypeSource),
        error: 'Saved image artifact bytes are ambiguous.',
        blobKey,
        store: 'artifacts',
        ...(shouldIncludeArtifactReadDiagnostics()
          ? { diagnostics: { matchingKeys: reconciliation.matchingKeys, nearbyKeys: reconciliation.nearbyKeys } }
          : {}),
      });
    }

    const buffer = reconciliation.bytes;

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
