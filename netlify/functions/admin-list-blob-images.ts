import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { isArtifactReference, reconcileImageArtifactReference, type ArtifactReference } from '../lib/artifacts.js';
import { collectBlobListItems, type BlobListResult } from '../lib/blob-list.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore } from '../lib/blob-store.js';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
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

type ArtifactBlobStore = Awaited<ReturnType<typeof getArtifactBlobStore>>;
type BinaryReadableArtifactBlobStore = Omit<ArtifactBlobStore, 'get'> & {
  get: (key: string, options: { type: 'buffer' }) => Promise<ArrayBuffer | Buffer | string | null>;
};

const requestArtifactPrefix = 'request-artifacts/';

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const getRequestArtifactPrefix = (requestId: string | undefined) => {
  const trimmed = requestId?.trim();

  return trimmed ? `${requestArtifactPrefix}${encodeURIComponent(trimmed)}/` : requestArtifactPrefix;
};

const listBlobKeys = async (store: ArtifactIndexBlobStore, prefix: string) => {
  if (typeof store.list !== 'function') {
    throw new Error('Artifact index blob store does not support listing artifact references.');
  }

  const result = await store.list({ prefix, directories: false, paginate: true });
  const blobs = await collectBlobListItems(result);

  return blobs.map((blob) => blob.key).filter((key) => key.endsWith('.json'));
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

const isImageArtifactReference = (reference: ArtifactReference) => {
  return reference.contentType.toLowerCase().startsWith('image/') || reference.blobKey.startsWith('image/');
};

const toReadErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;

  return 'Blob bytes could not be read.';
};

const readArtifactBlob = async (store: ArtifactBlobStore, reference: ArtifactReference) => {
  const binaryStore = store as unknown as BinaryReadableArtifactBlobStore;
  const reconciliation = await reconcileImageArtifactReference(reference, binaryStore);

  if (reconciliation.status !== 'found') throw new Error(`Artifact blob is ${reconciliation.status}.`);
};

const logSkippedArtifactReference = (reference: ArtifactReference, error: unknown) => {
  console.warn('Skipping stale image artifact reference because backing bytes could not be read.', {
    blobKey: reference.blobKey,
    sha256: reference.sha256,
    error: toReadErrorMessage(error),
  });
};

const listReadableImageArtifacts = async (
  indexStore: ArtifactIndexBlobStore,
  artifactStore: ArtifactBlobStore,
  prefix: string
) => {
  const keys = await listBlobKeys(indexStore, prefix);
  const candidates = await Promise.all(keys.map((key) => loadArtifactReference(indexStore, key)));
  const images: ArtifactReference[] = [];
  let skipped = 0;

  await Promise.all(
    candidates
      .filter((reference): reference is ArtifactReference => Boolean(reference && isImageArtifactReference(reference)))
      .map(async (reference) => {
        try {
          await readArtifactBlob(artifactStore, reference);
          images.push(reference);
        } catch (error) {
          skipped += 1;
          logSkippedArtifactReference(reference, error);
        }
      })
  );

  return { images, skipped };
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
    return jsonResponse(403, { error: 'This Clerk user is not authorized to list blob image artifacts.' });
  }

  try {
    const indexStore = await getArtifactIndexBlobStore(event);
    const artifactStore = await getArtifactBlobStore(event);
    const prefix = getRequestArtifactPrefix(event.queryStringParameters?.requestId);
    const { images, skipped } = await listReadableImageArtifacts(indexStore, artifactStore, prefix);

    return jsonResponse(200, { images, skipped });
  } catch (error) {
    console.error('Failed to list admin blob image artifacts.', error);

    return jsonResponse(500, { error: 'Blob image artifacts could not be listed.' });
  }
};
