import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import { handler as mcpHandler } from '../../netlify/functions/mcp.js';
import { handler as uploadChunkHandler } from '../../netlify/functions/upload-session-chunk.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore } from '../../netlify/lib/blob-store.js';

const localBlobRoot = new URL('../../.netlify/local-blobs/', import.meta.url);
const publishSecret = 'upload-session-integration-secret';

type ToolResult = Record<string, unknown>;

type UploadSession = {
  requestId: string;
  artifactKind: string;
  contentType: string;
  filename: string;
  bytes: Buffer;
  sha256: string;
  sessionId: string;
  uploadUrl: string;
  uploadToken: string;
  chunkSizeBytes: number;
  maxBytes: number;
  totalChunks: number;
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const deterministicBytes = (sizeBytes: number) => {
  const bytes = Buffer.allocUnsafe(sizeBytes);
  let offset = 0;
  let counter = 0;

  while (offset < sizeBytes) {
    const digest = createHash('sha256').update(`upload-session-test-${counter}`).digest();
    digest.copy(bytes, offset, 0, Math.min(digest.byteLength, sizeBytes - offset));
    offset += digest.byteLength;
    counter += 1;
  }

  return bytes;
};

const resetLocalBlobs = async () => {
  await rm(localBlobRoot, { recursive: true, force: true });
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  process.env.PUBLISH_SECRET = publishSecret;
};

const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
  const response = await mcpHandler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-publish-key': publishSecret },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = JSON.parse(response.body) as {
    result?: { structuredContent: ToolResult; isError?: boolean };
    error?: { message: string };
  };

  if (body.error) throw new Error(body.error.message);
  return body.result?.structuredContent ?? {};
};

const createSession = async ({
  requestId = `upload-session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  artifactKind = 'data',
  contentType = 'application/octet-stream',
  filename = 'artifact.bin',
  bytes = Buffer.from('session bytes'),
}: {
  requestId?: string;
  artifactKind?: string;
  contentType?: string;
  filename?: string;
  bytes?: Buffer;
} = {}): Promise<UploadSession> => {
  const expectedSha256 = sha256(bytes);
  const result = await callTool('create_upload_session', {
    requestId,
    artifactKind,
    contentType,
    filename,
    expectedSizeBytes: bytes.byteLength,
    expectedSha256,
    label: filename,
    tags: ['test'],
    metadata: { source: 'test' },
  });

  return {
    requestId,
    artifactKind,
    contentType,
    filename,
    bytes,
    sha256: expectedSha256,
    sessionId: result.sessionId as string,
    uploadUrl: result.uploadUrl as string,
    uploadToken: result.uploadToken as string,
    chunkSizeBytes: result.chunkSizeBytes as number,
    maxBytes: result.maxBytes as number,
    totalChunks: result.totalChunks as number,
  };
};

const uploadChunk = async ({
  sessionId,
  uploadToken,
  chunkIndex,
  totalChunks,
  bytes,
  chunkSha256,
}: {
  sessionId: string;
  uploadToken: string;
  chunkIndex: number;
  totalChunks: number;
  bytes: Buffer;
  chunkSha256?: string;
}) => {
  const response = await uploadChunkHandler({
    httpMethod: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      'x-session-id': sessionId,
      'x-upload-token': uploadToken,
      'x-chunk-index': String(chunkIndex),
      'x-total-chunks': String(totalChunks),
      ...(chunkSha256 ? { 'x-chunk-sha256': chunkSha256 } : {}),
    },
    isBase64Encoded: true,
    body: bytes.toString('base64'),
  });

  return { ...response, json: JSON.parse(response.body) as Record<string, unknown> };
};

const finalizeSession = async (session: UploadSession, overrides: Record<string, unknown> = {}) => {
  return callTool('finalize_upload_session', {
    sessionId: session.sessionId,
    requestId: session.requestId,
    artifactKind: session.artifactKind,
    contentType: session.contentType,
    filename: session.filename,
    expectedSizeBytes: session.bytes.byteLength,
    expectedSha256: session.sha256,
    label: session.filename,
    tags: ['test'],
    metadata: { source: 'test' },
    ...overrides,
  });
};

const splitChunks = (bytes: Buffer, chunkSizeBytes: number) => {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSizeBytes) {
    chunks.push(bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSizeBytes)));
  }
  return chunks.length ? chunks : [Buffer.alloc(0)];
};

test('upload session end-to-end stores artifact and is idempotent', async () => {
  await resetLocalBlobs();
  const bytes = deterministicBytes(5 * 1024 * 1024 + 123);
  const session = await createSession({ bytes, filename: 'artifact.bin' });
  const chunks = splitChunks(bytes, session.chunkSizeBytes);

  assert.match(session.sessionId, /^[0-9a-f-]{36}$/i);
  assert.equal(session.uploadUrl, '/.netlify/functions/upload-session-chunk');
  assert.equal(typeof session.uploadToken, 'string');
  assert.equal(session.chunkSizeBytes, 5 * 1024 * 1024);
  assert.equal(session.maxBytes, 50 * 1024 * 1024);
  assert.equal(session.totalChunks, 2);
  assert.equal(chunks.length, 2);

  const receivedSizes: number[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const response = await uploadChunk({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      chunkIndex: index,
      totalChunks: chunks.length,
      bytes: chunks[index],
      chunkSha256: sha256(chunks[index]),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json.ok, true);
    assert.equal(response.json.receivedBytes, chunks[index].byteLength);
    receivedSizes.push(response.json.receivedBytes as number);
  }
  assert.deepEqual(
    receivedSizes,
    chunks.map((chunk) => chunk.byteLength)
  );

  const duplicate = await uploadChunk({
    sessionId: session.sessionId,
    uploadToken: session.uploadToken,
    chunkIndex: 0,
    totalChunks: chunks.length,
    bytes: chunks[0],
    chunkSha256: sha256(chunks[0]),
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json.ok, true);
  assert.equal(duplicate.json.receivedBytes, chunks[0].byteLength);

  const finalized = await finalizeSession(session);
  const artifact = finalized.artifact as { blobKey: string; sha256: string; sizeBytes: number; contentType: string };
  assert.equal(finalized.complete, true);
  assert.equal(artifact.sha256, session.sha256);
  assert.equal(artifact.sizeBytes, bytes.byteLength);
  assert.equal(artifact.contentType, session.contentType);

  const retry = await finalizeSession(session);
  assert.deepEqual(retry.artifact, finalized.artifact);

  const artifactStore = await getArtifactBlobStore({});
  const stored = await (
    artifactStore as typeof artifactStore & {
      get: (key: string, options: { type: 'buffer' }) => Promise<Buffer | null>;
    }
  ).get(artifact.blobKey, { type: 'buffer' });
  assert.equal(stored?.byteLength, session.bytes.byteLength);
  assert.equal(stored && sha256(stored), session.sha256);

  const indexStore = await getArtifactIndexBlobStore({});
  const indexed = await indexStore.get(`request-artifacts/${session.requestId}/${session.sha256}.json`);
  assert.ok(indexed);
  const indexedArtifact = JSON.parse(indexed) as { sizeBytes: number; sha256: string; contentType: string };
  assert.equal(indexedArtifact.sizeBytes, session.bytes.byteLength);
  assert.equal(indexedArtifact.sha256, session.sha256);
  assert.equal(indexedArtifact.contentType, session.contentType);
});

test('upload session rejects missing chunks, wrong indexes, tampered chunks, and oversize sessions', async () => {
  await resetLocalBlobs();
  const bytes = deterministicBytes(5 * 1024 * 1024 + 10);
  const session = await createSession({ bytes });
  const chunks = splitChunks(bytes, session.chunkSizeBytes);

  const incomplete = await finalizeSession(session);
  assert.match(incomplete.error as string, /Upload session is incomplete/);

  const wrongIndex = await uploadChunk({
    sessionId: session.sessionId,
    uploadToken: session.uploadToken,
    chunkIndex: chunks.length,
    totalChunks: chunks.length,
    bytes: Buffer.from('wrong-index'),
  });
  assert.equal(wrongIndex.statusCode, 400);
  assert.equal(wrongIndex.json.error, 'chunkIndex must be less than totalChunks.');

  const tampered = await uploadChunk({
    sessionId: session.sessionId,
    uploadToken: session.uploadToken,
    chunkIndex: 0,
    totalChunks: chunks.length,
    bytes: chunks[0],
    chunkSha256: '0'.repeat(64),
  });
  assert.equal(tampered.statusCode, 400);
  assert.equal(tampered.json.error, 'x-chunk-sha256 does not match the uploaded chunk bytes.');

  const tooLarge = await callTool('create_upload_session', {
    requestId: `upload-session-too-large-${Date.now()}`,
    artifactKind: 'data',
    contentType: 'application/octet-stream',
    expectedSizeBytes: 50 * 1024 * 1024 + 1,
    expectedSha256: 'a'.repeat(64),
  });
  assert.match(tooLarge.error as string, /Too big|max|expectedSizeBytes/i);
});
