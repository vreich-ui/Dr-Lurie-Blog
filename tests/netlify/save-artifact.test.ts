import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import sharp from 'sharp';

import { handler, saveUploadedChunk } from '../../netlify/functions/save-artifact.js';
import {
  getArtifactBlobStore,
  getArtifactIndexBlobStore,
  setNetlifyBlobsModuleForTesting,
} from '../../netlify/lib/blob-store.js';

const publishSecret = 'artifact-test-secret';
const validJpegBytes = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIIAeC//2Q==',
  'base64'
);
const validJpegSha256 = createHash('sha256').update(validJpegBytes).digest('hex');

const deterministicBytes = (sizeBytes: number) => {
  const chunks: Buffer[] = [];
  let counter = 0;

  while (Buffer.concat(chunks).byteLength < sizeBytes) {
    chunks.push(createHash('sha256').update(`artifact-test-${counter}`).digest());
    counter += 1;
  }

  return Buffer.concat(chunks).subarray(0, sizeBytes);
};

const createNoiseJpeg = async (width: number, height: number, quality: number) => {
  return sharp(deterministicBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .toBuffer();
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

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

const listArtifactsWithMcp = async (requestId: string) => {
  const { handler: mcpHandler } = await import('../../netlify/functions/mcp.js');
  const listResponse = await mcpHandler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: { name: 'list_artifacts_for_request', arguments: { requestId } },
    }),
  });
  const listBody = JSON.parse(listResponse.body) as {
    result: { structuredContent: { artifacts: unknown[] } };
  };

  return listBody.result.structuredContent.artifacts;
};

const postChunkedJpeg = async ({
  requestId,
  bytes,
  chunkSizeBytes,
  expectedSizeBytes = bytes.byteLength,
  expectedSha256 = sha256(bytes),
}: {
  requestId: string;
  bytes: Buffer;
  chunkSizeBytes: number;
  expectedSizeBytes?: number;
  expectedSha256?: string;
}) => {
  const clientUploadId = randomUUID();
  const totalChunks = Math.ceil(bytes.byteLength / chunkSizeBytes);
  let response: Awaited<ReturnType<typeof postArtifact>> | undefined;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const chunk = bytes.subarray(
      chunkIndex * chunkSizeBytes,
      Math.min(bytes.byteLength, (chunkIndex + 1) * chunkSizeBytes)
    );
    response = await postArtifact({
      ...makeBaseInput(requestId),
      contentType: 'image/jpeg',
      filename: 'chunked-regression.jpg',
      clientUploadId,
      chunkIndex,
      totalChunks,
      encoding: 'base64',
      expectedSizeBytes,
      expectedSha256,
      localSizeBytes: expectedSizeBytes,
      localSha256: expectedSha256,
      payload: chunk.toString('base64'),
    });
  }

  if (!response) throw new Error('Expected at least one chunk response.');

  return response;
};

test('save-artifact chunk status stays monotonic when an immediate chunk read is stale', async () => {
  type FakeStoreValue = Buffer | string;
  const values = new Map<string, FakeStoreValue>();
  const hiddenImmediateChunkReads = new Set<string>();
  const fakeStore = {
    async set(key: string, value: string | Buffer | Uint8Array | ArrayBuffer) {
      values.set(
        key,
        typeof value === 'string' ? value : value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value)
      );
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

test('save-artifact retries stale final artifact readback before saving request index', async () => {
  type FakeStoreValue = Buffer | string;
  const previousPublishSecret = process.env.NETLIFY_PUBLISH_SECRET;
  const previousFallbackSecret = process.env.PUBLISH_SECRET;
  const previousNetlify = process.env.NETLIFY;
  const previousSiteId = process.env.NETLIFY_SITE_ID;
  const artifactValues = new Map<string, FakeStoreValue>();
  const indexValues = new Map<string, FakeStoreValue>();
  const hiddenFinalArtifactReads = new Set<string>();
  const finalArtifactArrayBufferReads = new Map<string, number>();
  const deletedFinalArtifactKeys: string[] = [];
  const createFakeStore = (values: Map<string, FakeStoreValue>, hideFirstFinalRead: boolean) => ({
    async set(key: string, value: string | Buffer | Uint8Array | ArrayBuffer) {
      values.set(
        key,
        typeof value === 'string' ? value : value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value)
      );
      if (hideFirstFinalRead && key.startsWith('image/')) hiddenFinalArtifactReads.add(key);
    },
    async setJSON(key: string, value: unknown) {
      values.set(key, JSON.stringify(value));
    },
    async get(key: string, options?: { type?: 'arrayBuffer' | 'buffer' | 'text' }) {
      const value = values.get(key);
      if (value === undefined) return null;

      if (hideFirstFinalRead && key.startsWith('image/') && options?.type === 'arrayBuffer') {
        finalArtifactArrayBufferReads.set(key, (finalArtifactArrayBufferReads.get(key) ?? 0) + 1);
        if (hiddenFinalArtifactReads.has(key)) {
          hiddenFinalArtifactReads.delete(key);
          return null;
        }
      }

      if (options?.type === 'arrayBuffer') {
        const bytes = typeof value === 'string' ? Buffer.from(value) : value;

        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }

      if (options?.type === 'buffer') return typeof value === 'string' ? Buffer.from(value) : value;

      return typeof value === 'string' ? value : value.toString('utf8');
    },
    async del(key: string) {
      if (hideFirstFinalRead && key.startsWith('image/')) deletedFinalArtifactKeys.push(key);
      values.delete(key);
    },
    async list() {
      return { blobs: [...values.keys()].map((key) => ({ key, etag: '' })), directories: [] };
    },
  });
  const artifactStore = createFakeStore(artifactValues, true);
  const indexStore = createFakeStore(indexValues, false);

  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'true';
  process.env.NETLIFY_SITE_ID = '';
  setNetlifyBlobsModuleForTesting({
    connectLambda() {},
    getStore(input) {
      const storeName = typeof input === 'string' ? input : input.name;

      if (storeName === 'artifacts')
        return artifactStore as ReturnType<typeof getArtifactBlobStore> extends Promise<infer Store> ? Store : never;
      if (storeName === 'artifact-index')
        return indexStore as ReturnType<typeof getArtifactIndexBlobStore> extends Promise<infer Store> ? Store : never;
      throw new Error(`Unexpected blob store: ${storeName}`);
    },
  });

  try {
    const requestId = `stale-final-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payloadBytes = Buffer.from('final artifact bytes eventually visible');
    const response = await postArtifact({
      ...makeBaseInput(requestId),
      encoding: 'base64',
      payload: payloadBytes.toString('base64'),
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json.complete, true);
    assert.equal(response.json.deduped, false);

    const artifact = response.json.artifact as { blobKey: string; sha256: string };
    assert.equal(finalArtifactArrayBufferReads.get(artifact.blobKey), 2);

    const indexedReferenceText = indexValues.get(`request-artifacts/${requestId}/${artifact.sha256}.json`);
    assert.deepEqual(deletedFinalArtifactKeys, []);
    assert.equal(typeof indexedReferenceText, 'string');
    assert.deepEqual(JSON.parse(indexedReferenceText as string), response.json.artifact);
  } finally {
    setNetlifyBlobsModuleForTesting(undefined);

    if (previousPublishSecret === undefined) delete process.env.NETLIFY_PUBLISH_SECRET;
    else process.env.NETLIFY_PUBLISH_SECRET = previousPublishSecret;

    if (previousFallbackSecret === undefined) delete process.env.PUBLISH_SECRET;
    else process.env.PUBLISH_SECRET = previousFallbackSecret;

    if (previousNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = previousNetlify;

    if (previousSiteId === undefined) delete process.env.NETLIFY_SITE_ID;
    else process.env.NETLIFY_SITE_ID = previousSiteId;
  }
});

test('save-artifact deletes final artifact blob when readback retries are exhausted', async () => {
  type FakeStoreValue = Buffer | string;
  const previousPublishSecret = process.env.NETLIFY_PUBLISH_SECRET;
  const previousFallbackSecret = process.env.PUBLISH_SECRET;
  const previousNetlify = process.env.NETLIFY;
  const previousSiteId = process.env.NETLIFY_SITE_ID;
  const artifactValues = new Map<string, FakeStoreValue>();
  const indexValues = new Map<string, FakeStoreValue>();
  const deletedArtifactKeys: string[] = [];
  const artifactStore = {
    async set(key: string, value: string | Buffer | Uint8Array | ArrayBuffer) {
      artifactValues.set(
        key,
        typeof value === 'string' ? value : value instanceof ArrayBuffer ? Buffer.from(value) : Buffer.from(value)
      );
    },
    async setJSON(key: string, value: unknown) {
      artifactValues.set(key, JSON.stringify(value));
    },
    async get(key: string, options?: { type?: 'arrayBuffer' | 'buffer' | 'text' }) {
      const value = artifactValues.get(key);
      if (value === undefined) return null;
      if (key.startsWith('image/') && options?.type === 'arrayBuffer') return null;
      if (options?.type === 'arrayBuffer') {
        const bytes = typeof value === 'string' ? Buffer.from(value) : value;

        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      if (options?.type === 'buffer') return typeof value === 'string' ? Buffer.from(value) : value;

      return typeof value === 'string' ? value : value.toString('utf8');
    },
    async del(key: string) {
      deletedArtifactKeys.push(key);
      artifactValues.delete(key);
    },
    async list() {
      return { blobs: [...artifactValues.keys()].map((key) => ({ key, etag: '' })), directories: [] };
    },
  };
  const indexStore = {
    async set() {},
    async setJSON(key: string, value: unknown) {
      indexValues.set(key, JSON.stringify(value));
    },
    async get(key: string) {
      return (indexValues.get(key) as string | undefined) ?? null;
    },
    async del(key: string) {
      indexValues.delete(key);
    },
    async list() {
      return { blobs: [...indexValues.keys()].map((key) => ({ key, etag: '' })), directories: [] };
    },
  };

  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'true';
  process.env.NETLIFY_SITE_ID = '';
  setNetlifyBlobsModuleForTesting({
    connectLambda() {},
    getStore(input) {
      const storeName = typeof input === 'string' ? input : input.name;

      if (storeName === 'artifacts')
        return artifactStore as ReturnType<typeof getArtifactBlobStore> extends Promise<infer Store> ? Store : never;
      if (storeName === 'artifact-index')
        return indexStore as ReturnType<typeof getArtifactIndexBlobStore> extends Promise<infer Store> ? Store : never;
      throw new Error(`Unexpected blob store: ${storeName}`);
    },
  });

  try {
    const requestId = `unreadable-final-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payloadBytes = Buffer.from('final artifact bytes never visible');
    const expectedSha256 = sha256(payloadBytes);
    const expectedBlobKey = `image/${requestId}/${expectedSha256}.png`;
    const response = await postArtifact({
      ...makeBaseInput(requestId),
      encoding: 'base64',
      payload: payloadBytes.toString('base64'),
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json, { error: 'Artifact blob write failed: stored bytes could not be read back.' });
    assert.deepEqual(deletedArtifactKeys, [expectedBlobKey]);
    assert.equal(artifactValues.has(expectedBlobKey), false);
    assert.equal(indexValues.size, 0);
  } finally {
    setNetlifyBlobsModuleForTesting(undefined);

    if (previousPublishSecret === undefined) delete process.env.NETLIFY_PUBLISH_SECRET;
    else process.env.NETLIFY_PUBLISH_SECRET = previousPublishSecret;

    if (previousFallbackSecret === undefined) delete process.env.PUBLISH_SECRET;
    else process.env.PUBLISH_SECRET = previousFallbackSecret;

    if (previousNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = previousNetlify;

    if (previousSiteId === undefined) delete process.env.NETLIFY_SITE_ID;
    else process.env.NETLIFY_SITE_ID = previousSiteId;
  }
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

test('save-artifact accepts a valid JPEG upload with matching expected size and sha256', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `jpeg-valid-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await postArtifact({
    ...makeBaseInput(requestId),
    contentType: 'image/jpeg',
    filename: 'photo.jpg',
    encoding: 'base64',
    expectedSizeBytes: validJpegBytes.byteLength,
    expectedSha256: validJpegSha256,
    payload: validJpegBytes.toString('base64'),
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json.complete, true);
  assert.equal(response.json.deduped, false);

  const artifact = response.json.artifact as { blobKey: string; sha256: string; sizeBytes: number };

  assert.equal(artifact.sizeBytes, validJpegBytes.byteLength);
  assert.equal(artifact.sha256, validJpegSha256);

  const artifactStore = await getArtifactBlobStore({});
  const retrievedBytes = await (
    artifactStore as typeof artifactStore & {
      get: (key: string, options: { type: 'buffer' }) => Promise<Buffer | null>;
    }
  ).get(artifact.blobKey, { type: 'buffer' });

  assert.ok(Buffer.isBuffer(retrievedBytes));
  assert.equal(createHash('sha256').update(retrievedBytes).digest('hex'), validJpegSha256);
});

test('save-artifact accepts localSizeBytes and localSha256 as integrity aliases', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `jpeg-local-alias-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await postArtifact({
    ...makeBaseInput(requestId),
    contentType: 'image/jpeg',
    filename: 'photo.jpg',
    encoding: 'base64',
    localSizeBytes: validJpegBytes.byteLength,
    localSha256: validJpegSha256,
    payload: validJpegBytes.toString('base64'),
  });

  assert.equal(response.statusCode, 201);
  const artifact = response.json.artifact as { sha256: string; sizeBytes: number };

  assert.equal(artifact.sizeBytes, validJpegBytes.byteLength);
  assert.equal(artifact.sha256, validJpegSha256);
});

test('save-artifact rejects a truncated JPEG without writing final artifact or index records', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `jpeg-truncated-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const truncatedJpegBytes = validJpegBytes.subarray(0, validJpegBytes.byteLength - 2);
  const response = await postArtifact({
    ...makeBaseInput(requestId),
    contentType: 'image/jpeg',
    filename: 'photo.jpg',
    encoding: 'base64',
    expectedSizeBytes: truncatedJpegBytes.byteLength,
    expectedSha256: createHash('sha256').update(truncatedJpegBytes).digest('hex'),
    payload: truncatedJpegBytes.toString('base64'),
  });

  assert.equal(response.statusCode, 400);

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});

  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
});

test('save-artifact rejects a valid JPEG when expectedSha256 is a valid but wrong digest', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `jpeg-sha-mismatch-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const wrongSha256 = '0'.repeat(64);
  const response = await postArtifact({
    ...makeBaseInput(requestId),
    contentType: 'image/jpeg',
    filename: 'photo.jpg',
    encoding: 'base64',
    expectedSizeBytes: validJpegBytes.byteLength,
    expectedSha256: wrongSha256,
    payload: validJpegBytes.toString('base64'),
  });

  assert.equal(response.statusCode, 400);

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});

  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
});

test('save-artifact rejects JPEG aliases without required SOI and EOI markers before final persistence', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `jpeg-marker-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await postArtifact({
    ...makeBaseInput(requestId),
    contentType: 'image/jpg',
    filename: 'photo.jpg',
    encoding: 'base64',
    payload: Buffer.from('not a jpeg').toString('base64'),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json, { error: 'Invalid JPEG artifact: missing SOI or EOI marker.' });

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});

  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
});

test('save-artifact rejects JPEG bytes that have markers but cannot be decoded before final persistence', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `jpeg-decode-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const invalidJpegBytes = Buffer.from([0xff, 0xd8, 0x00, 0x00, 0xff, 0xd9]);
  const response = await postArtifact({
    ...makeBaseInput(requestId),
    contentType: 'image/jpeg',
    filename: 'photo.jpg',
    encoding: 'base64',
    payload: invalidJpegBytes.toString('base64'),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json, { error: 'Invalid JPEG artifact: image bytes could not be decoded.' });

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});

  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
});

test('save-artifact rejects client-provided blobKey and non-whitelisted artifactKind before persistence', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `schema-reject-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bytes = Buffer.from('schema checked bytes');

  const blobKeyResponse = await postArtifact({
    ...makeBaseInput(requestId),
    blobKey: `image/${requestId}/${'a'.repeat(64)}.png`,
    encoding: 'base64',
    payload: bytes.toString('base64'),
  });

  assert.equal(blobKeyResponse.statusCode, 400);
  assert.equal(blobKeyResponse.json.error, 'Invalid artifact upload input');
  assert.match(JSON.stringify(blobKeyResponse.json.issues), /Unrecognized key/);

  const artifactKindResponse = await postArtifact({
    ...makeBaseInput(requestId),
    artifactKind: 'markdown',
    encoding: 'base64',
    payload: bytes.toString('base64'),
  });

  assert.equal(artifactKindResponse.statusCode, 400);
  assert.equal(artifactKindResponse.json.error, 'Invalid artifact upload input');
  assert.match(JSON.stringify(artifactKindResponse.json.issues), /artifactKind/);

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});

  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
});

test('save-artifact rejects a single-shot upload when expected size does not match decoded bytes', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `size-mismatch-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bytes = Buffer.from('size checked bytes');
  const response = await postArtifact({
    ...makeBaseInput(requestId),
    encoding: 'base64',
    expectedSizeBytes: bytes.byteLength + 1,
    payload: bytes.toString('base64'),
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json, {
    error: `Artifact size mismatch: expected ${bytes.byteLength + 1} bytes, received ${bytes.byteLength} bytes.`,
  });

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});

  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
});

test('save-artifact keeps chunked uploads incomplete before validating final expected size', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `chunked-size-pending-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clientUploadId = randomUUID();
  const firstChunk = Buffer.from('first chunk');
  const expectedSizeBytes = firstChunk.byteLength + Buffer.from('second chunk').byteLength;
  const partial = await postArtifact({
    ...makeBaseInput(requestId),
    clientUploadId,
    chunkIndex: 0,
    totalChunks: 2,
    encoding: 'base64',
    expectedSizeBytes,
    payload: firstChunk.toString('base64'),
  });

  assert.equal(partial.statusCode, 202);
  assert.deepEqual(partial.json, { ok: true, complete: false, receivedChunks: 1, totalChunks: 2 });

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});

  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
});

test('save-artifact rejects chunked upload attempts that change totalChunks for an existing manifest', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `chunked-total-mismatch-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clientUploadId = randomUUID();
  const firstChunk = Buffer.from('first total chunk');
  const firstPartial = await postArtifact({
    ...makeBaseInput(requestId),
    clientUploadId,
    chunkIndex: 0,
    totalChunks: 2,
    encoding: 'base64',
    payload: firstChunk.toString('base64'),
  });

  assert.equal(firstPartial.statusCode, 202);
  assert.deepEqual(firstPartial.json, { ok: true, complete: false, receivedChunks: 1, totalChunks: 2 });

  const retry = await postArtifact({
    ...makeBaseInput(requestId),
    clientUploadId,
    chunkIndex: 0,
    totalChunks: 2,
    encoding: 'base64',
    payload: firstChunk.toString('base64'),
  });

  assert.equal(retry.statusCode, 202);
  assert.deepEqual(retry.json, { ok: true, complete: false, receivedChunks: 1, totalChunks: 2 });

  const mismatch = await postArtifact({
    ...makeBaseInput(requestId),
    clientUploadId,
    chunkIndex: 1,
    totalChunks: 3,
    encoding: 'base64',
    payload: Buffer.from('second total chunk').toString('base64'),
  });

  assert.equal(mismatch.statusCode, 400);
  assert.deepEqual(mismatch.json, {
    error: `Chunk upload totalChunks mismatch for clientUploadId ${clientUploadId}: expected existing total 2, received 3.`,
  });

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});
  const chunkPrefix = `artifact-chunks/${requestId}/${clientUploadId}/`;

  assert.deepEqual((await artifactStore.list({ prefix: chunkPrefix })).blobs.map((blob) => blob.key).sort(), [
    `${chunkPrefix}0`,
    `${chunkPrefix}manifest.json`,
  ]);
  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
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

test('save-artifact finalizes chunked JPEG uploads with matching expected size and sha256', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `chunked-jpeg-valid-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clientUploadId = randomUUID();
  const splitIndex = Math.ceil(validJpegBytes.byteLength / 2);
  const chunkBuffers = [validJpegBytes.subarray(0, splitIndex), validJpegBytes.subarray(splitIndex)];

  const partial = await postArtifact({
    ...makeBaseInput(requestId),
    contentType: 'image/jpeg',
    filename: 'chunked.jpg',
    clientUploadId,
    chunkIndex: 0,
    totalChunks: 2,
    encoding: 'base64',
    expectedSizeBytes: validJpegBytes.byteLength,
    expectedSha256: validJpegSha256,
    payload: chunkBuffers[0].toString('base64'),
  });

  assert.equal(partial.statusCode, 202);
  assert.deepEqual(partial.json, { ok: true, complete: false, receivedChunks: 1, totalChunks: 2 });

  const completed = await postArtifact({
    ...makeBaseInput(requestId),
    contentType: 'image/jpeg',
    filename: 'chunked.jpg',
    clientUploadId,
    chunkIndex: 1,
    totalChunks: 2,
    encoding: 'base64',
    expectedSizeBytes: validJpegBytes.byteLength,
    expectedSha256: validJpegSha256,
    payload: chunkBuffers[1].toString('base64'),
  });

  assert.equal(completed.statusCode, 201);
  assert.equal(completed.json.complete, true);
  assert.equal(completed.json.receivedChunks, 2);
  assert.equal(completed.json.totalChunks, 2);

  const artifact = completed.json.artifact as { blobKey: string; sha256: string; sizeBytes: number };

  assert.equal(artifact.sha256, validJpegSha256);
  assert.equal(artifact.sizeBytes, validJpegBytes.byteLength);

  const artifactStore = await getArtifactBlobStore({});
  const retrievedBytes = await (
    artifactStore as typeof artifactStore & {
      get: (key: string, options: { type: 'buffer' }) => Promise<Buffer | null>;
    }
  ).get(artifact.blobKey, { type: 'buffer' });

  assert.ok(Buffer.isBuffer(retrievedBytes));
  assert.equal(createHash('sha256').update(retrievedBytes).digest('hex'), validJpegSha256);
});

test('save-artifact rejects completed chunked JPEG only after assembled bytes fail validation', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `chunked-jpeg-invalid-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clientUploadId = randomUUID();
  const firstChunk = Buffer.from([0xff, 0xd8, 0x00]);
  const secondChunk = Buffer.from([0x00, 0xff, 0xd9]);
  const expectedBytes = Buffer.concat([firstChunk, secondChunk]);

  const partial = await postArtifact({
    ...makeBaseInput(requestId),
    contentType: 'image/jpeg',
    filename: 'chunked.jpg',
    clientUploadId,
    chunkIndex: 0,
    totalChunks: 2,
    encoding: 'base64',
    expectedSizeBytes: expectedBytes.byteLength,
    expectedSha256: createHash('sha256').update(expectedBytes).digest('hex'),
    payload: firstChunk.toString('base64'),
  });

  assert.equal(partial.statusCode, 202);
  assert.deepEqual(partial.json, { ok: true, complete: false, receivedChunks: 1, totalChunks: 2 });

  const completed = await postArtifact({
    ...makeBaseInput(requestId),
    contentType: 'image/jpeg',
    filename: 'chunked.jpg',
    clientUploadId,
    chunkIndex: 1,
    totalChunks: 2,
    encoding: 'base64',
    expectedSizeBytes: expectedBytes.byteLength,
    expectedSha256: createHash('sha256').update(expectedBytes).digest('hex'),
    payload: secondChunk.toString('base64'),
  });

  assert.equal(completed.statusCode, 400);
  assert.deepEqual(completed.json, { error: 'Invalid JPEG artifact: image bytes could not be decoded.' });

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});

  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
});

test('save-artifact rejects a completed chunked upload when expected sha256 does not match assembled bytes', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `sha-mismatch-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const baseInput = makeBaseInput(requestId);
  const clientUploadId = randomUUID();
  const chunkBuffers = [Buffer.from('chunk-zero-'), Buffer.from('chunk-one')];
  const badSha256 = '0'.repeat(64);
  const actualSha256 = createHash('sha256').update(Buffer.concat(chunkBuffers)).digest('hex');

  const partial = await postArtifact({
    ...baseInput,
    clientUploadId,
    chunkIndex: 0,
    totalChunks: 2,
    encoding: 'base64',
    expectedSha256: badSha256,
    payload: chunkBuffers[0].toString('base64'),
  });

  assert.equal(partial.statusCode, 202);

  const completed = await postArtifact({
    ...baseInput,
    clientUploadId,
    chunkIndex: 1,
    totalChunks: 2,
    encoding: 'base64',
    expectedSha256: badSha256,
    payload: chunkBuffers[1].toString('base64'),
  });

  assert.equal(completed.statusCode, 400);
  assert.deepEqual(completed.json, {
    error: `Artifact sha256 mismatch: expected ${badSha256}, received ${actualSha256}.`,
  });

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});

  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
});

test('save-artifact preserves a valid 1-2 KB JPEG chunked upload with exact size and sha256', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const jpegBytes = await createNoiseJpeg(48, 48, 85);
  assert.ok(jpegBytes.byteLength >= 1024 && jpegBytes.byteLength <= 2048);

  const requestId = `chunked-jpeg-small-regression-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const completed = await postChunkedJpeg({ requestId, bytes: jpegBytes, chunkSizeBytes: 257 });

  assert.equal(completed.statusCode, 201);
  const artifact = completed.json.artifact as { blobKey: string; sha256: string; sizeBytes: number };
  assert.equal(artifact.sizeBytes, jpegBytes.byteLength);
  assert.equal(artifact.sha256, sha256(jpegBytes));

  const artifactStore = await getArtifactBlobStore({});
  const storedBytes = await (
    artifactStore as typeof artifactStore & {
      get: (key: string, options: { type: 'buffer' }) => Promise<Buffer | null>;
    }
  ).get(artifact.blobKey, { type: 'buffer' });

  assert.ok(Buffer.isBuffer(storedBytes));
  assert.equal(storedBytes.byteLength, jpegBytes.byteLength);
  assert.equal(sha256(storedBytes), sha256(jpegBytes));
});

test('save-artifact preserves a valid 20-25 KB JPEG chunked upload with exact size and sha256', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const jpegBytes = await createNoiseJpeg(180, 180, 80);
  assert.ok(jpegBytes.byteLength >= 20 * 1024 && jpegBytes.byteLength <= 25 * 1024);

  const requestId = `chunked-jpeg-large-regression-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const completed = await postChunkedJpeg({ requestId, bytes: jpegBytes, chunkSizeBytes: 4097 });

  assert.equal(completed.statusCode, 201);
  const artifact = completed.json.artifact as { blobKey: string; sha256: string; sizeBytes: number };
  assert.equal(artifact.sizeBytes, jpegBytes.byteLength);
  assert.equal(artifact.sha256, sha256(jpegBytes));

  const artifactStore = await getArtifactBlobStore({});
  const storedBytes = await (
    artifactStore as typeof artifactStore & {
      get: (key: string, options: { type: 'buffer' }) => Promise<Buffer | null>;
    }
  ).get(artifact.blobKey, { type: 'buffer' });

  assert.ok(Buffer.isBuffer(storedBytes));
  assert.equal(storedBytes.byteLength, jpegBytes.byteLength);
  assert.equal(sha256(storedBytes), sha256(jpegBytes));
});

test('save-artifact rejects a completed chunked upload when expected size does not match assembled bytes', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `chunked-size-mismatch-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const jpegBytes = await createNoiseJpeg(48, 48, 85);
  const completed = await postChunkedJpeg({
    requestId,
    bytes: jpegBytes,
    chunkSizeBytes: 311,
    expectedSizeBytes: jpegBytes.byteLength + 10,
  });

  assert.equal(completed.statusCode, 400);
  assert.deepEqual(completed.json, {
    error: `Artifact size mismatch: expected ${jpegBytes.byteLength + 10} bytes, received ${jpegBytes.byteLength} bytes.`,
  });
  assert.deepEqual(await listArtifactsWithMcp(requestId), []);

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});

  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
});

test('save-artifact rejects a chunked truncated JPEG and leaves no listed artifact', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `chunked-truncated-jpeg-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const truncatedBytes = validJpegBytes.subarray(0, validJpegBytes.byteLength - 2);
  const completed = await postChunkedJpeg({ requestId, bytes: truncatedBytes, chunkSizeBytes: 17 });

  assert.equal(completed.statusCode, 400);
  assert.deepEqual(completed.json, { error: 'Invalid JPEG artifact: missing SOI or EOI marker.' });
  assert.deepEqual(await listArtifactsWithMcp(requestId), []);

  const artifactStore = await getArtifactBlobStore({});
  const indexStore = await getArtifactIndexBlobStore({});

  assert.deepEqual((await artifactStore.list({ prefix: `image/${requestId}/` })).blobs, []);
  assert.deepEqual((await indexStore.list({ prefix: `request-artifacts/${requestId}/` })).blobs, []);
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
