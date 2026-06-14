import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { handler as mcpHandler } from '../../netlify/functions/mcp.js';
import { handler as uploadChunkHandler } from '../../netlify/functions/save-artifact-upload-chunk.js';
import { getArtifactBlobStore, getArtifactIndexBlobStore } from '../../netlify/lib/blob-store.js';

type ToolResult = Record<string, unknown>;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
  const response = await mcpHandler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
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
} = {}) => {
  const result = await callTool('save_artifact_create_upload_session', {
    requestId,
    artifactKind,
    contentType,
    filename,
    expectedSizeBytes: bytes.byteLength,
    expectedSha256: sha256(bytes),
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
    sha256: sha256(bytes),
    sessionId: result.sessionId as string,
    uploadToken: result.uploadToken as string,
    chunkSizeBytes: result.chunkSizeBytes as number,
    maxBytes: result.maxBytes as number,
  };
};

const uploadChunk = async ({
  sessionId,
  uploadToken,
  chunkIndex,
  totalChunks,
  bytes,
}: {
  sessionId: string;
  uploadToken: string;
  chunkIndex: number;
  totalChunks: number;
  bytes: Buffer;
}) => {
  const response = await uploadChunkHandler({
    httpMethod: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      'x-session-id': sessionId,
      'x-upload-token': uploadToken,
      'x-chunk-index': String(chunkIndex),
      'x-total-chunks': String(totalChunks),
    },
    isBase64Encoded: true,
    body: bytes.toString('base64'),
  });

  return { ...response, json: JSON.parse(response.body) as Record<string, unknown> };
};

const finalizeSession = async (
  session: Awaited<ReturnType<typeof createSession>>,
  overrides: Record<string, unknown> = {}
) => {
  return callTool('save_artifact_finalize_upload_session', {
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

test('upload session creation returns binary upload parameters', async () => {
  process.env.NETLIFY = 'false';
  const session = await createSession();

  assert.match(session.sessionId, /^[0-9a-f-]{36}$/i);
  assert.equal(typeof session.uploadToken, 'string');
  assert.equal(session.chunkSizeBytes, 5 * 1024 * 1024);
  assert.equal(session.maxBytes, 50 * 1024 * 1024);
});

test('upload session uploads chunks and finalizes a PDF artifact', async () => {
  process.env.NETLIFY = 'false';
  const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(40_000, 7), Buffer.from('\n%%EOF')]);
  const session = await createSession({
    artifactKind: 'pdf',
    contentType: 'application/pdf',
    filename: 'paper.pdf',
    bytes,
  });
  const chunks = splitChunks(bytes, session.chunkSizeBytes);

  for (let index = 0; index < chunks.length; index += 1) {
    const response = await uploadChunk({
      sessionId: session.sessionId,
      uploadToken: session.uploadToken,
      chunkIndex: index,
      totalChunks: chunks.length,
      bytes: chunks[index],
    });
    assert.equal(response.json.ok, true);
  }

  const finalized = await finalizeSession(session);
  const artifact = finalized.artifact as { blobKey: string; sha256: string; sizeBytes: number; contentType: string };

  assert.equal(finalized.complete, true);
  assert.equal(artifact.sha256, session.sha256);
  assert.equal(artifact.sizeBytes, bytes.byteLength);
  assert.equal(artifact.contentType, 'application/pdf');
  assert.equal(artifact.blobKey.endsWith('.pdf'), true);

  const artifactStore = await getArtifactBlobStore({});
  const stored = await (
    artifactStore as typeof artifactStore & {
      get: (key: string, options: { type: 'buffer' }) => Promise<Buffer | null>;
    }
  ).get(artifact.blobKey, { type: 'buffer' });
  assert.equal(stored && sha256(stored), session.sha256);

  const indexStore = await getArtifactIndexBlobStore({});
  const indexed = await indexStore.get(`request-artifacts/${session.requestId}/${session.sha256}.json`);
  assert.ok(indexed);
});

test('upload session supports resume and duplicate chunk upload', async () => {
  process.env.NETLIFY = 'false';
  const bytes = Buffer.concat([Buffer.alloc(5 * 1024 * 1024, 1), Buffer.from('tail')]);
  const session = await createSession({ bytes });
  const chunks = splitChunks(bytes, session.chunkSizeBytes);

  const first = await uploadChunk({
    sessionId: session.sessionId,
    uploadToken: session.uploadToken,
    chunkIndex: 0,
    totalChunks: chunks.length,
    bytes: chunks[0],
  });
  const duplicate = await uploadChunk({
    sessionId: session.sessionId,
    uploadToken: session.uploadToken,
    chunkIndex: 0,
    totalChunks: chunks.length,
    bytes: chunks[0],
  });

  assert.equal(first.statusCode, 202);
  assert.equal(duplicate.statusCode, 200);

  const incomplete = await finalizeSession(session);
  assert.equal(incomplete.error, 'Upload session is incomplete.');

  const second = await uploadChunk({
    sessionId: session.sessionId,
    uploadToken: session.uploadToken,
    chunkIndex: 1,
    totalChunks: chunks.length,
    bytes: chunks[1],
  });
  assert.equal(second.json.complete, true);

  const finalized = await finalizeSession(session);
  const retry = await finalizeSession(session);

  assert.equal((finalized.artifact as { sha256: string }).sha256, session.sha256);
  assert.deepEqual(retry.artifact, finalized.artifact);
});

test('upload session rejects size mismatch, hash mismatch, incomplete upload, and conflicting duplicate chunks', async () => {
  process.env.NETLIFY = 'false';
  const bytes = Buffer.from('integrity checks');
  const session = await createSession({ bytes });

  assert.equal((await finalizeSession(session)).error, 'Upload session is incomplete.');
  assert.equal(
    (await finalizeSession(session, { expectedSizeBytes: bytes.byteLength + 1 })).error,
    'expectedSizeBytes does not match upload session.'
  );
  assert.equal(
    (await finalizeSession(session, { expectedSha256: '0'.repeat(64) })).error,
    'expectedSha256 does not match upload session.'
  );

  const chunks = splitChunks(bytes, session.chunkSizeBytes);
  await uploadChunk({
    sessionId: session.sessionId,
    uploadToken: session.uploadToken,
    chunkIndex: 0,
    totalChunks: chunks.length,
    bytes: chunks[0],
  });
  const conflict = await uploadChunk({
    sessionId: session.sessionId,
    uploadToken: session.uploadToken,
    chunkIndex: 0,
    totalChunks: chunks.length,
    bytes: Buffer.from('different'),
  });

  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json.error, 'Chunk digest mismatch for existing chunk.');
});
