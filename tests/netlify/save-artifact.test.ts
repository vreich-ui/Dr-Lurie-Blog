import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { handler, saveUploadedChunk } from '../../netlify/functions/save-artifact.js';
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

test('save-artifact chunk status stays monotonic when an immediate chunk read is stale', async () => {
  type FakeStoreValue = Buffer | string;
  const values = new Map<string, FakeStoreValue>();
  const hiddenImmediateChunkReads = new Set<string>();
  const fakeStore = {
    async set(key: string, value: string | Buffer | Uint8Array | ArrayBuffer) {
      values.set(key, typeof value === 'string' ? value : Buffer.from(value));
      if (key.endsWith('/1') || key.endsWith('/2')) hiddenImmediateChunkReads.add(key);
    },
    async setJSON(key: string, value: unknown) {
      values.set(key, JSON.stringify(value));
    },
    async get(key: string, options?: { type?: 'arrayBuffer' | 'buffer' | 'text' }) {
      if (hiddenImmediateChunkReads.has(key) && options?.type === 'arrayBuffer') {
        hiddenImmediateChunkReads.delete(key);
        return null;
      }

      const value = values.get(key);
      if (value === undefined) return null;

      if (options?.type === 'arrayBuffer') {
        const bytes = typeof value === 'string' ? Buffer.from(value) : value;

        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }

      if (options?.type === 'buffer') return typeof value === 'string' ? Buffer.from(value) : value;

      return typeof value === 'string' ? value : value.toString('utf8');
    },
    async del(key: string) {
      values.delete(key);
    },
    async list() {
      return { blobs: [...values.keys()].map((key) => ({ key, etag: '' })), directories: [] };
    },
  };

  const requestId = `stale-status-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clientUploadId = randomUUID();
  const statuses: Array<{ receivedChunks: number }> = [];

  for (const chunkIndex of [0, 1, 2]) {
    statuses.push(
      await saveUploadedChunk(
        fakeStore as Parameters<typeof saveUploadedChunk>[0],
        requestId,
        clientUploadId,
        chunkIndex,
        3,
        Buffer.from(`chunk-${chunkIndex}`)
      )
    );
  }

  assert.deepEqual(
    statuses.map((status) => status.receivedChunks),
    [1, 2, 3]
  );
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

test('save-artifact chunked uploads collect three chunks by request and client upload before finalizing', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `chunked-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const baseInput = makeBaseInput(requestId);
  const clientUploadId = randomUUID();
  const chunkBuffers = [Buffer.from('chunk-zero-'), Buffer.from('chunk-one-'), Buffer.from('chunk-two')];
  const chunkPayloads = chunkBuffers.map((chunk) => chunk.toString('base64'));
  const expectedBytes = Buffer.concat(chunkBuffers);
  const expectedSha256 = createHash('sha256').update(expectedBytes).digest('hex');

  const firstPartial = await postArtifact({
    ...baseInput,
    clientUploadId,
    chunkIndex: 0,
    totalChunks: 3,
    encoding: 'base64',
    payload: chunkPayloads[0],
  });

  assert.equal(firstPartial.statusCode, 202);
  assert.equal(firstPartial.json.complete, false);
  assert.equal(firstPartial.json.receivedChunks, 1);
  assert.equal(firstPartial.json.totalChunks, 3);

  const secondPartial = await postArtifact({
    ...baseInput,
    clientUploadId,
    chunkIndex: 1,
    totalChunks: 3,
    encoding: 'base64',
    payload: chunkPayloads[1],
  });

  assert.equal(secondPartial.statusCode, 202);
  assert.equal(secondPartial.json.complete, false);
  assert.equal(secondPartial.json.receivedChunks, 2);
  assert.equal(secondPartial.json.totalChunks, 3);

  const indexStore = await getArtifactIndexBlobStore({});
  const prematureIndexes = await indexStore.list({ prefix: `request-artifacts/${requestId}/` });

  assert.equal(prematureIndexes.blobs.length, 0);

  const completed = await postArtifact({
    ...baseInput,
    clientUploadId,
    chunkIndex: 2,
    totalChunks: 3,
    encoding: 'base64',
    payload: chunkPayloads[2],
  });

  assert.equal(completed.statusCode, 201);
  assert.equal(completed.json.complete, true);
  assert.equal(completed.json.deduped, false);
  assert.equal(completed.json.receivedChunks, 3);
  assert.equal(completed.json.totalChunks, 3);

  const completedArtifact = completed.json.artifact as { blobKey: string; sha256: string; sizeBytes: number };

  assert.equal(completedArtifact.sha256, expectedSha256);
  assert.equal(completedArtifact.sizeBytes, expectedBytes.byteLength);

  const completedIndexes = await indexStore.list({ prefix: `request-artifacts/${requestId}/` });

  assert.deepEqual(
    completedIndexes.blobs.map((blob) => blob.key),
    [`request-artifacts/${requestId}/${completedArtifact.sha256}.json`]
  );

  const completedIndexedReferenceText = await indexStore.get(
    `request-artifacts/${requestId}/${completedArtifact.sha256}.json`
  );
  const completedIndexedReference = completedIndexedReferenceText
    ? (JSON.parse(completedIndexedReferenceText) as unknown)
    : null;

  assert.deepEqual(completedIndexedReference, completed.json.artifact);

  const refinalized = await postArtifact({
    ...baseInput,
    clientUploadId,
    chunkIndex: 2,
    totalChunks: 3,
    encoding: 'base64',
    payload: chunkPayloads[2],
  });

  assert.equal(refinalized.statusCode, 200);
  assert.equal(refinalized.json.complete, true);
  assert.equal(refinalized.json.deduped, true);
  assert.equal(refinalized.json.receivedChunks, 3);
  assert.equal(refinalized.json.totalChunks, 3);
  assert.deepEqual(refinalized.json.artifact, completed.json.artifact);

  const chunkPrefix = `artifact-chunks/${requestId}/${clientUploadId}/`;
  const indexChunkList = await indexStore.list({ prefix: chunkPrefix });

  assert.deepEqual(indexChunkList.blobs, []);

  const artifactStore = await getArtifactBlobStore({});
  const finalBlobs = await artifactStore.list({ prefix: `image/${requestId}/` });
  const chunkList = await artifactStore.list({ prefix: chunkPrefix });

  assert.deepEqual(
    finalBlobs.blobs.map((blob) => blob.key),
    [completedArtifact.blobKey]
  );
  assert.deepEqual(chunkList.blobs.map((blob) => blob.key).sort(), [
    `${chunkPrefix}0`,
    `${chunkPrefix}1`,
    `${chunkPrefix}2`,
    `${chunkPrefix}manifest.json`,
  ]);
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

test('MCP artifact tools upload bytes and list request references', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const { handler: mcpHandler } = await import('../../netlify/functions/mcp.js');
  const requestId = `mcp-artifact-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const uploadBytes = Buffer.from('mcp artifact bytes');
  const uploadResponse = await mcpHandler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'save_artifact',
        arguments: {
          ...makeBaseInput(requestId),
          expectedSizeBytes: uploadBytes.byteLength,
          expectedSha256: createHash('sha256').update(uploadBytes).digest('hex').toUpperCase(),
          payload: uploadBytes.toString('base64'),
        },
      },
    }),
  });

  assert.equal(uploadResponse.statusCode, 200);
  const uploadBody = JSON.parse(uploadResponse.body) as {
    result: { structuredContent: { artifact: { sha256: string }; complete: boolean } };
  };
  assert.equal(uploadBody.result.structuredContent.complete, true);

  const listResponse = await mcpHandler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_artifacts_for_request', arguments: { requestId } },
    }),
  });

  assert.equal(listResponse.statusCode, 200);
  const listBody = JSON.parse(listResponse.body) as {
    result: { structuredContent: { artifacts: Array<{ sha256: string }> } };
  };

  assert.deepEqual(listBody.result.structuredContent.artifacts, [uploadBody.result.structuredContent.artifact]);
});
