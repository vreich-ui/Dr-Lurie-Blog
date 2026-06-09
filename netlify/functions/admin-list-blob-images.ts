import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { collectBlobListItems, type BlobListResult } from '../lib/blob-list.js';
import { getArtifactIndexBlobStore } from '../lib/blob-store.js';
import { isArtifactReference, type ArtifactReference } from '../lib/artifacts.js';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

type LambdaEvent = {
  blobs?: string;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
};

type ArtifactIndexBlobStore = Awaited<ReturnType<typeof getArtifactIndexBlobStore>> & {
  list?: (options?: {
    prefix?: string;
    directories?: boolean;
    paginate?: boolean;
  }) => Promise<BlobListResult> | AsyncIterable<BlobListResult>;
};

const indexPrefix = 'request-artifacts/';

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

const isImageArtifactReference = (reference: ArtifactReference) => {
  return reference.contentType.toLowerCase().startsWith('image/') || reference.blobKey.startsWith('image/');
};

const listArtifactIndexKeys = async (store: ArtifactIndexBlobStore) => {
  if (typeof store.list !== 'function') {
    throw new Error('Artifact index blob store does not support listing image artifacts.');
  }

  const result = await store.list({ prefix: indexPrefix, directories: false, paginate: true });
  const blobs = await collectBlobListItems(result);

  return blobs.map((blob) => blob.key).filter((key) => key.endsWith('.json'));
};

const loadArtifactReference = async (store: ArtifactIndexBlobStore, key: string) => {
  const raw = await store.get(key);
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isArtifactReference(parsed) && isImageArtifactReference(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const listBlobImages = async (store: ArtifactIndexBlobStore) => {
  const keys = await listArtifactIndexKeys(store);
  const artifacts = await Promise.all(keys.map((key) => loadArtifactReference(store, key)));
  const byBlobKey = new Map<string, ArtifactReference>();

  artifacts.forEach((artifact) => {
    if (artifact) byBlobKey.set(artifact.blobKey, artifact);
  });

  return Array.from(byBlobKey.values()).sort((a, b) => Date.parse(b.createdAtISO) - Date.parse(a.createdAtISO));
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
    return jsonResponse(403, { error: 'This Clerk user is not authorized to list saved image artifacts.' });
  }

  try {
    const store = await getArtifactIndexBlobStore(event);
    const images = await listBlobImages(store);

    return jsonResponse(200, { images });
  } catch (error) {
    console.error('Failed to list saved image artifacts.', error);

    return jsonResponse(500, { error: 'Saved image artifacts could not be listed.' });
  }
};
