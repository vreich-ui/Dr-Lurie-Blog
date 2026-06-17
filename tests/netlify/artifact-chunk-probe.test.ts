import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';

const publishSecret = 'mcp-probe-test-secret';

const createMcpCall = (toolName: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id: `test-${Date.now()}`,
  method: 'tools/call',
  params: { name: toolName, arguments: args },
});

test('probe_artifact_chunk_size detects transport truncation', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  const requestId = `req-${randomUUID()}`;
  const clientUploadId = randomUUID();
  const bytes = Buffer.from('this is a test payload');
  const base64 = bytes.toString('base64');

  // Send a payload that is shorter than expectedChunkRawBytes
  const mcpRequest = createMcpCall('probe_artifact_chunk_size', {
    requestId,
    clientUploadId,
    chunkIndex: 0,
    totalChunks: 1,
    payload: base64,
    expectedChunkRawBytes: bytes.length + 10, // Truncation!
    artifactKind: 'data',
    contentType: 'application/octet-stream',
    expectedSizeBytes: bytes.length,
    expectedSha256: createHash('sha256').update(bytes).digest('hex'),
    label: 'probe-test',
  });

  const response = await handler({
    httpMethod: 'POST',
    headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
    body: JSON.stringify(mcpRequest),
  });

  const body = JSON.parse(response.body) as { result?: { isError?: boolean, structuredContent?: Record<string, any> } };
  const content = body.result?.structuredContent;

  assert.equal(body.result?.isError, true);
  assert.equal(content?.error, 'transport_truncation');
  assert.equal(content?.reason, 'received_less_than_expected');
  assert.equal(content?.received, bytes.length);
  assert.equal(content?.expected, bytes.length + 10);
});

test('probe_artifact_chunk_size passes when transport and server validation are ok', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  const requestId = `req-${randomUUID()}`;
  const clientUploadId = randomUUID();
  const bytes = Buffer.from('valid probe payload');
  const base64 = bytes.toString('base64');
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const mcpRequest = createMcpCall('probe_artifact_chunk_size', {
    requestId,
    clientUploadId,
    chunkIndex: 0,
    totalChunks: 1,
    payload: base64,
    expectedChunkRawBytes: bytes.length,
    artifactKind: 'data',
    contentType: 'application/octet-stream',
    expectedSizeBytes: bytes.length,
    expectedSha256: sha256,
    label: 'probe-pass-test',
  });

  const response = await handler({
    httpMethod: 'POST',
    headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
    body: JSON.stringify(mcpRequest),
  });

  const body = JSON.parse(response.body) as { result?: { isError?: boolean, structuredContent?: Record<string, any> } };
  const content = body.result?.structuredContent;

  assert.equal(body.result?.isError, undefined);
  assert.equal(content?.ok, true);
  assert.equal(content?.complete, true);
  assert.deepEqual(content?.probe, {
    status: 'success',
    transportOk: true,
    receivedChunkRawBytes: bytes.length,
  });
});

test('probe_artifact_chunk_size reports server-side validation errors (SHA mismatch)', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = publishSecret;
  const requestId = `req-${randomUUID()}`;
  const clientUploadId = randomUUID();
  const bytes = Buffer.from('sha mismatch payload');
  const base64 = bytes.toString('base64');

  const mcpRequest = createMcpCall('probe_artifact_chunk_size', {
    requestId,
    clientUploadId,
    chunkIndex: 0,
    totalChunks: 1,
    payload: base64,
    expectedChunkRawBytes: bytes.length,
    artifactKind: 'data',
    contentType: 'application/octet-stream',
    expectedSizeBytes: bytes.length,
    expectedSha256: '0'.repeat(64), // Wrong SHA
    label: 'probe-sha-fail-test',
  });

  const response = await handler({
    httpMethod: 'POST',
    headers: { 'x-publish-key': publishSecret, 'content-type': 'application/json' },
    body: JSON.stringify(mcpRequest),
  });

  const body = JSON.parse(response.body) as { result?: { isError?: boolean, structuredContent?: Record<string, any> } };
  const content = body.result?.structuredContent;

  assert.equal(body.result?.isError, true);
  assert.equal(content?.failureType, 'expected_sha_mismatch');
  assert.deepEqual(content?.probe, {
    transportOk: true,
    receivedChunkRawBytes: bytes.length,
  });
});
