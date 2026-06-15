import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readAdminBlobImage } from '../../netlify/functions/admin-get-blob-image.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore } from '../../netlify/lib/blob-store.js';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const makeReference = (requestId, bytes, filename = 'hero.png') => ({
    blobKey: `image/${requestId}/${sha256(bytes)}.png`,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
    contentType: 'image/png',
    createdAtISO: new Date().toISOString(),
    artifactKind: 'image',
    originalFilename: filename,
    label: filename,
});
const setReference = async (requestId, reference) => {
    const indexStore = await getArtifactIndexBlobStore({});
    await indexStore.setJSON(`request-artifacts/${encodeURIComponent(requestId)}/${reference.sha256}.json`, reference, {
        metadata: {
            requestId,
            sha256: reference.sha256,
            contentType: reference.contentType,
        },
    });
};
const setArtifactBytes = async (reference, bytes, blobKey = reference.blobKey) => {
    const artifactStore = await getArtifactBlobStore({});
    await artifactStore.set(blobKey, bytes, {
        metadata: {
            contentType: reference.contentType,
            sha256: reference.sha256,
            sizeBytes: String(reference.sizeBytes),
            createdAtISO: reference.createdAtISO,
        },
    });
};
test('admin-get-blob-image reports missing artifact bytes distinctly', async () => {
    process.env.NETLIFY = 'false';
    process.env.NETLIFY_SITE_ID = '';
    process.env.CONTEXT = 'dev';
    const requestId = `admin-image-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const bytes = Buffer.from('missing image bytes');
    const reference = makeReference(requestId, bytes);
    await setReference(requestId, reference);
    const response = await readAdminBlobImage({ queryStringParameters: { contentType: 'image/png' } }, reference.blobKey);
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 404);
    assert.equal(body.reason, 'missing-artifact-bytes');
    assert.equal(body.diagnostics?.exactFilenameExists, false);
});
test('admin-get-blob-image reports ambiguous artifact bytes distinctly', async () => {
    process.env.NETLIFY = 'false';
    process.env.NETLIFY_SITE_ID = '';
    process.env.CONTEXT = 'dev';
    const requestId = `admin-image-ambiguous-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const bytes = Buffer.from(`ambiguous image bytes ${requestId}`);
    const reference = makeReference(requestId, bytes);
    const artifactStore = await getArtifactBlobStore({});
    await setReference(requestId, reference);
    await artifactStore.del(reference.blobKey);
    await setArtifactBytes(reference, bytes, `image/${requestId}-one/${reference.sha256}.png`);
    await setArtifactBytes(reference, bytes, `image/${requestId}-two/${reference.sha256}.png`);
    const response = await readAdminBlobImage({ queryStringParameters: { contentType: 'image/png' } }, reference.blobKey);
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 409);
    assert.equal(body.reason, 'ambiguous-artifact-bytes');
    assert.equal(body.diagnostics?.matchingKeys?.length, 2);
});
test('admin-get-blob-image validates present but corrupt artifact bytes', async () => {
    process.env.NETLIFY = 'false';
    process.env.NETLIFY_SITE_ID = '';
    process.env.CONTEXT = 'dev';
    const requestId = `admin-image-corrupt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const bytes = Buffer.from('not a png image');
    const reference = makeReference(requestId, bytes);
    await setReference(requestId, reference);
    await setArtifactBytes(reference, bytes);
    const response = await readAdminBlobImage({ queryStringParameters: { contentType: 'image/png' } }, reference.blobKey);
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 422);
    assert.equal(body.reason, 'invalid-image-bytes');
    assert.match(body.validationReason ?? '', /could not be decoded as a valid PNG/);
    assert.match(body.error ?? '', /Invalid image artifact/);
});
