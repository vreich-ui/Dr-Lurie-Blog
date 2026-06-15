import { getAdminStateFromEvent } from '../lib/admin-auth.js';
import { isArtifactReference, isDeletedArtifactReference } from '../lib/artifacts.js';
import { collectBlobListItems } from '../lib/blob-list.js';
import { getArtifactIndexBlobStore } from '../lib/blob-store.js';
const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};
const requestArtifactPrefix = 'request-artifacts/';
const imageArtifactKind = 'image';
const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, ...body }),
});
const getRequestArtifactPrefix = (requestId) => {
    const trimmed = requestId?.trim();
    return trimmed ? `${requestArtifactPrefix}${encodeURIComponent(trimmed)}/` : requestArtifactPrefix;
};
const getImageArtifactPointerPrefix = (requestId) => {
    const trimmed = requestId?.trim();
    return trimmed ? `by-request/${encodeURIComponent(trimmed)}/${imageArtifactKind}/` : `by-kind/${imageArtifactKind}/`;
};
const requestArtifactReferenceKey = (requestId, sha256) => {
    return `${requestArtifactPrefix}${encodeURIComponent(requestId)}/${sha256}.json`;
};
const listBlobKeys = async (store, prefix) => {
    if (typeof store.list !== 'function') {
        throw new Error('Artifact index blob store does not support listing artifact references.');
    }
    const result = await store.list({ prefix, directories: false, paginate: true });
    const blobs = await collectBlobListItems(result);
    return blobs.map((blob) => blob.key).filter((key) => key.endsWith('.json'));
};
const parseJsonBlob = async (store, key) => {
    const raw = await store.get(key);
    if (!raw)
        return undefined;
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
};
const loadArtifactReference = async (store, key) => {
    const parsed = await parseJsonBlob(store, key);
    return isArtifactReference(parsed) ? parsed : undefined;
};
const toNonEmptyString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const loadArtifactReferenceFromPointer = async (store, key) => {
    const pointer = await parseJsonBlob(store, key);
    const pointerValue = pointer && typeof pointer === 'object' ? pointer : undefined;
    const requestId = toNonEmptyString(pointerValue?.requestId);
    const sha256 = toNonEmptyString(pointerValue?.sha256);
    if (!requestId || !sha256)
        return undefined;
    return loadArtifactReference(store, requestArtifactReferenceKey(requestId, sha256));
};
const isImageArtifactReference = (reference) => {
    return reference.contentType.toLowerCase().startsWith('image/') || reference.blobKey.startsWith('image/');
};
const listImageArtifacts = async (indexStore, requestId) => {
    const pointerKeys = await listBlobKeys(indexStore, getImageArtifactPointerPrefix(requestId));
    const candidates = pointerKeys.length
        ? await Promise.all(pointerKeys.map((key) => loadArtifactReferenceFromPointer(indexStore, key)))
        : await Promise.all((await listBlobKeys(indexStore, getRequestArtifactPrefix(requestId))).map((key) => loadArtifactReference(indexStore, key)));
    return candidates.filter((reference) => Boolean(reference && !isDeletedArtifactReference(reference) && isImageArtifactReference(reference)));
};
export const handler = async (event) => {
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
        const images = await listImageArtifacts(indexStore, event.queryStringParameters?.requestId);
        return jsonResponse(200, { images, skipped: 0 });
    }
    catch (error) {
        console.error('Failed to list admin blob image artifacts.', error);
        return jsonResponse(500, { error: 'Blob image artifacts could not be listed.' });
    }
};
