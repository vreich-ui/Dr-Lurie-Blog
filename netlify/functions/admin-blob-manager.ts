import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { readArtifactReference, type ArtifactIndexStore } from '../lib/artifact-index.js';
import { normalizeArtifactBlobKey } from '../lib/artifacts.js';
import { getManagedBlobStore, listManagedBlobStores } from '../lib/blob-admin.js';
import { collectBlobListItems } from '../lib/blob-list.js';
import type { Store } from '@netlify/blobs';

type LambdaEvent = {
  blobs?: unknown;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  httpMethod?: string;
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: jsonHeaders,
  body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});

// Listing safety cap so a single request can never try to materialize an
// unbounded store in memory.
const MAX_LISTED_KEYS = 10_000;
// Largest payload returned inline when viewing a blob.
const MAX_TEXT_PREVIEW_BYTES = 512 * 1024;
const MAX_BINARY_PREVIEW_BYTES = 2 * 1024 * 1024;
// Concurrency used when bulk-deleting during a wipe.
const DELETE_BATCH_SIZE = 25;

const parseBody = (event: LambdaEvent): Record<string, unknown> => {
  if (!event.body) return {};

  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const asTrimmed = (value: unknown): string | undefined => {
  const str = typeof value === 'string' ? value.trim() : '';
  return str.length > 0 ? str : undefined;
};

// Heuristic check so the viewer can render text inline but treat binary blobs
// (images, audio, etc.) as base64 downloads.
const looksLikeText = (buffer: Buffer): boolean => {
  const sample = buffer.subarray(0, 4096);
  let suspicious = 0;

  for (const byte of sample) {
    if (byte === 0) return false;
    // Allow common whitespace control chars; flag other control bytes.
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }

  return suspicious / Math.max(sample.length, 1) < 0.1;
};

const listStoreKeys = async (store: Store, prefix?: string) => {
  const result = await store.list({ ...(prefix ? { prefix } : {}), paginate: true });
  const items = await collectBlobListItems(result);

  return items.map((item) => item.key);
};

const deleteKeysInBatches = async (store: Store, keys: string[]) => {
  let deleted = 0;

  for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
    const batch = keys.slice(index, index + DELETE_BATCH_SIZE);
    await Promise.all(batch.map((key) => store.delete(key)));
    deleted += batch.length;
  }

  return deleted;
};

const getStoreHandle = (storeName: string, event: LambdaEvent) => getManagedBlobStore(storeName, event);

const readBlobBuffer = async (store: Store, key: string) => {
  const result = await store.getWithMetadata(key, { type: 'arrayBuffer' });
  if (!result || result.data === null || result.data === undefined) return null;

  return {
    buffer: Buffer.from(result.data as ArrayBuffer),
    metadata: result.metadata ?? {},
  };
};

type ActionHandler = (params: Record<string, unknown>, event: LambdaEvent) => Promise<ReturnType<typeof jsonResponse>>;

const handleListStores: ActionHandler = async (_params, event) => {
  const stores = await listManagedBlobStores(event);
  return jsonResponse(200, { stores: stores.sort((a, b) => a.localeCompare(b)) });
};

const handleListBlobs: ActionHandler = async (params, event) => {
  const storeName = asTrimmed(params.store);
  if (!storeName) return jsonResponse(400, { error: 'A store name is required.' });

  const prefix = asString(params.prefix);
  const search = asTrimmed(params.search)?.toLowerCase();
  const store = getStoreHandle(storeName, event);

  let keys = await listStoreKeys(store, prefix);

  if (search) {
    keys = keys.filter((key) => key.toLowerCase().includes(search));
  }

  keys.sort((a, b) => a.localeCompare(b));
  const truncated = keys.length > MAX_LISTED_KEYS;

  return jsonResponse(200, {
    store: storeName,
    count: keys.length,
    truncated,
    keys: truncated ? keys.slice(0, MAX_LISTED_KEYS) : keys,
  });
};

const handleGetBlob: ActionHandler = async (params, event) => {
  const storeName = asTrimmed(params.store);
  const key = asString(params.key);
  if (!storeName || !key) return jsonResponse(400, { error: 'A store name and key are required.' });

  const store = getStoreHandle(storeName, event);
  const blob = await readBlobBuffer(store, key);
  if (!blob) return jsonResponse(404, { error: 'Blob not found.' });

  const { buffer, metadata } = blob;
  const size = buffer.byteLength;
  const declaredType = metadata.contentType || metadata['content-type'];
  const isText = declaredType
    ? declaredType.startsWith('text/') || /json|xml|javascript|csv/.test(declaredType)
    : looksLikeText(buffer);

  if (isText) {
    if (size > MAX_TEXT_PREVIEW_BYTES) {
      return jsonResponse(200, {
        store: storeName,
        key,
        size,
        metadata,
        encoding: 'text',
        truncated: true,
        content: '',
      });
    }

    return jsonResponse(200, {
      store: storeName,
      key,
      size,
      metadata,
      contentType: declaredType,
      encoding: 'text',
      truncated: false,
      content: buffer.toString('utf8'),
    });
  }

  if (size > MAX_BINARY_PREVIEW_BYTES) {
    return jsonResponse(200, {
      store: storeName,
      key,
      size,
      metadata,
      encoding: 'base64',
      truncated: true,
      content: '',
    });
  }

  return jsonResponse(200, {
    store: storeName,
    key,
    size,
    metadata,
    contentType: declaredType,
    encoding: 'base64',
    truncated: false,
    content: buffer.toString('base64'),
  });
};

const handleSetBlob: ActionHandler = async (params, event) => {
  const storeName = asTrimmed(params.store);
  const key = asString(params.key);
  if (!storeName || !key) return jsonResponse(400, { error: 'A store name and key are required.' });

  const encoding = params.encoding === 'base64' ? 'base64' : 'text';
  const content = typeof params.content === 'string' ? params.content : '';
  const contentType = asTrimmed(params.contentType);

  const store = getStoreHandle(storeName, event);
  const value = encoding === 'base64' ? Buffer.from(content, 'base64') : content;
  const options = contentType ? { metadata: { contentType } } : undefined;

  await store.set(key, value, options);

  return jsonResponse(200, { store: storeName, key });
};

const handleDeleteBlob: ActionHandler = async (params, event) => {
  const storeName = asTrimmed(params.store);
  const key = asString(params.key);
  if (!storeName || !key) return jsonResponse(400, { error: 'A store name and key are required.' });

  await getStoreHandle(storeName, event).delete(key);

  return jsonResponse(200, { store: storeName, key });
};

const copyBlob = async (store: Store, sourceKey: string, targetKey: string) => {
  const blob = await readBlobBuffer(store, sourceKey);
  if (!blob) return false;

  const options = Object.keys(blob.metadata).length ? { metadata: blob.metadata } : undefined;
  await store.set(targetKey, blob.buffer, options);

  return true;
};

const handleDuplicateBlob: ActionHandler = async (params, event) => {
  const storeName = asTrimmed(params.store);
  const key = asString(params.key);
  const targetKey = asString(params.targetKey);
  if (!storeName || !key || !targetKey) {
    return jsonResponse(400, { error: 'A store name, source key, and target key are required.' });
  }

  if (key === targetKey) return jsonResponse(400, { error: 'The target key must differ from the source key.' });

  const store = getStoreHandle(storeName, event);
  const copied = await copyBlob(store, key, targetKey);
  if (!copied) return jsonResponse(404, { error: 'Source blob not found.' });

  return jsonResponse(200, { store: storeName, key, targetKey });
};

const handleRenameBlob: ActionHandler = async (params, event) => {
  const storeName = asTrimmed(params.store);
  const key = asString(params.key);
  const targetKey = asString(params.targetKey);
  if (!storeName || !key || !targetKey) {
    return jsonResponse(400, { error: 'A store name, source key, and target key are required.' });
  }

  if (key === targetKey) return jsonResponse(400, { error: 'The new key must differ from the current key.' });

  const store = getStoreHandle(storeName, event);
  const copied = await copyBlob(store, key, targetKey);
  if (!copied) return jsonResponse(404, { error: 'Source blob not found.' });

  await store.delete(key);

  return jsonResponse(200, { store: storeName, key, targetKey });
};

const handleWipeStore: ActionHandler = async (params, event) => {
  const storeName = asTrimmed(params.store);
  if (!storeName) return jsonResponse(400, { error: 'A store name is required.' });

  const store = getStoreHandle(storeName, event);
  const keys = await listStoreKeys(store);
  const deleted = await deleteKeysInBatches(store, keys);

  return jsonResponse(200, { store: storeName, deleted });
};

const handleWipeAll: ActionHandler = async (params, event) => {
  if (asTrimmed(params.confirm) !== 'WIPE ALL') {
    return jsonResponse(400, { error: 'Confirmation phrase "WIPE ALL" is required to wipe every store.' });
  }

  const stores = await listManagedBlobStores(event);
  const summary: Array<{ store: string; deleted: number }> = [];
  let totalDeleted = 0;

  for (const storeName of stores) {
    const store = getStoreHandle(storeName, event);
    const keys = await listStoreKeys(store);
    const deleted = await deleteKeysInBatches(store, keys);

    summary.push({ store: storeName, deleted });
    totalDeleted += deleted;
  }

  return jsonResponse(200, { stores: summary, totalDeleted });
};

const handleGetArtifactMetadata: ActionHandler = async (params, event) => {
  const blobKey = asString(params.blobKey);
  if (!blobKey) return jsonResponse(400, { error: 'A blobKey is required.' });

  const normalized = normalizeArtifactBlobKey(blobKey);
  const parts = normalized.split('/');
  if (parts.length < 3) {
    return jsonResponse(400, { error: 'Invalid artifact blob key structure.' });
  }

  const [, requestId, filename] = parts;
  const sha256 = filename?.match(/^[a-f0-9]{64}/i)?.[0]?.toLowerCase();

  if (!requestId || !sha256) {
    return jsonResponse(400, { error: 'Could not extract requestId or sha256 from blob key.' });
  }

  const indexStore = getStoreHandle('artifact-index', event) as unknown as ArtifactIndexStore;
  const artifact = await readArtifactReference(indexStore, requestId, sha256);

  if (!artifact) {
    return jsonResponse(404, { error: 'Artifact metadata not found.' });
  }

  return jsonResponse(200, { artifact });
};

const actionHandlers: Record<string, ActionHandler> = {
  'list-stores': handleListStores,
  'list-blobs': handleListBlobs,
  'get-blob': handleGetBlob,
  'set-blob': handleSetBlob,
  'delete-blob': handleDeleteBlob,
  'duplicate-blob': handleDuplicateBlob,
  'rename-blob': handleRenameBlob,
  'wipe-store': handleWipeStore,
  'wipe-all': handleWipeAll,
  'get-artifact-metadata': handleGetArtifactMetadata,
};

export const handler = async (event: LambdaEvent) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const adminState = await getAdminStateFromEvent(event);
  if (!adminState.authenticated) {
    return jsonResponse(adminState.error === 'Clerk authentication is not configured.' ? 500 : 401, {
      error: adminState.error || 'A valid Clerk session token is required.',
    });
  }

  if (!adminState.isAdmin) {
    return jsonResponse(403, { error: 'This Clerk user is not authorized to manage blob stores.' });
  }

  const params = parseBody(event);
  const action = asTrimmed(params.action);
  const actionHandler = action ? actionHandlers[action] : undefined;

  if (!actionHandler) {
    return jsonResponse(400, { error: `Unknown or missing action.` });
  }

  try {
    return await actionHandler(params, event);
  } catch (error) {
    console.error(`Blob manager action "${action}" failed.`, error);
    return jsonResponse(500, { error: 'The blob store operation failed.' });
  }
};
