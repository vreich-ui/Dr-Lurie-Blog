import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { handler } from '../../netlify/functions/save-artifact.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore } from '../../netlify/lib/blob-store.js';

const publishSecret = 'artifact-test-secret';

const postArtifact = async (body: Record<string, unknown>) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    ...response,
    json: JSON.parse(response.body) as Record<string, unknown>,
  };
};

const makeBaseInput = (requestId: string) => ({
  requestId,
  artifactKind: 'image',
  contentType: 'image/png',
  filename: 'hero.png',
});

test('save-artifact single-shot uploads dedupe by checksum', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `artifact-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const baseInput = makeBaseInput(requestId);
  const payload = Buffer.from('same image bytes').toString('base64');
  const first = await postArtifact({ ...baseInput, encoding: 'base64', payload });

  assert.equal(first.statusCode, 201);
  assert.equal(first.json.complete, true);
  assert.equal(first.json.deduped, false);

  const firstArtifact = first.json.artifact as { blobKey: string; sha256: string };
  const second = await postArtifact({ ...baseInput, encoding: 'base64', payload });

  assert.equal(second.statusCode, 200);
  assert.equal(second.json.complete, true);
  assert.equal(second.json.deduped, true);
  assert.deepEqual(second.json.artifact, first.json.artifact);

  const artifactStore = await getArtifactBlobStore({});
  const artifactList = await artifactStore.list({ prefix: `image/${requestId}/` });

  assert.deepEqual(
    artifactList.blobs.map((blob) => blob.key),
    [firstArtifact.blobKey]
  );

  const indexStore = await getArtifactIndexBlobStore({});
  const indexedReferenceText = await indexStore.get(`request-artifacts/${requestId}/${firstArtifact.sha256}.json`);
  const indexedReference = indexedReferenceText ? (JSON.parse(indexedReferenceText) as unknown) : null;

  assert.deepEqual(indexedReference, first.json.artifact);
});

test('save-artifact chunked uploads wait for all chunks and finalization is idempotent', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `chunked-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const baseInput = makeBaseInput(requestId);
  const clientUploadId = randomUUID();
  const chunk0 = Buffer.from('chunk-zero-').toString('base64');
  const chunk1 = Buffer.from('chunk-one').toString('base64');

  const partial = await postArtifact({
    ...baseInput,
    clientUploadId,
    chunkIndex: 0,
    totalChunks: 2,
    encoding: 'base64',
    payload: chunk0,
  });

  assert.equal(partial.statusCode, 202);
  assert.equal(partial.json.complete, false);

  const indexStore = await getArtifactIndexBlobStore({});
  const prematureIndexes = await indexStore.list({ prefix: `request-artifacts/${requestId}/` });

  assert.equal(prematureIndexes.blobs.length, 0);

  const completed = await postArtifact({
    ...baseInput,
    clientUploadId,
    chunkIndex: 1,
    totalChunks: 2,
    encoding: 'base64',
    payload: chunk1,
  });

  assert.equal(completed.statusCode, 201);
  assert.equal(completed.json.complete, true);
  assert.equal(completed.json.deduped, false);

  const refinalized = await postArtifact({
    ...baseInput,
    clientUploadId,
    chunkIndex: 1,
    totalChunks: 2,
    encoding: 'base64',
    payload: chunk1,
  });

  assert.equal(refinalized.statusCode, 200);
  assert.equal(refinalized.json.complete, true);
  assert.equal(refinalized.json.deduped, true);
  assert.deepEqual(refinalized.json.artifact, completed.json.artifact);

  const completedArtifact = completed.json.artifact as { blobKey: string };
  const artifactStore = await getArtifactBlobStore({});
  const finalBlobs = await artifactStore.list({ prefix: `image/${requestId}/` });

  assert.deepEqual(
    finalBlobs.blobs.map((blob) => blob.key),
    [completedArtifact.blobKey]
  );
});

test('save-artifact requires the publish secret', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;

  const response = await handler({
    httpMethod: 'POST',
    headers: { 'x-publish-key': 'wrong-secret', 'content-type': 'application/json' },
    body: JSON.stringify({
      ...makeBaseInput('unauthorized-request'),
      payload: Buffer.from('bytes').toString('base64'),
    }),
  });

  assert.equal(response.statusCode, 401);
});
