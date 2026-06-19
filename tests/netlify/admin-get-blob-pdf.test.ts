import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { handler } from '../../netlify/functions/admin-get-blob-pdf.js';
import { getArtifactBlobStore } from '../../netlify/lib/blob-store.js';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const setArtifactBytes = async (blobKey: string, bytes: Buffer) => {
  const artifactStore = await getArtifactBlobStore({});

  await artifactStore.set(blobKey, bytes, {
    metadata: {
      contentType: 'application/pdf',
      sha256: sha256(bytes),
      sizeBytes: String(bytes.byteLength),
    },
  });
};

test('admin-get-blob-pdf streams PDF artifact with admin access', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';
  process.env.CONTEXT = 'dev';
  process.env.NETLIFY_PUBLISH_SECRET = 'test-secret';

  const requestId = `admin-pdf-stream-${Date.now()}`;
  const bytes = Buffer.from('%PDF-1.4 test pdf content');
  const blobKey = `pdf/${requestId}/${sha256(bytes)}.pdf`;
  await setArtifactBytes(blobKey, bytes);

  const event = {
    httpMethod: 'GET',
    headers: { 'x-publish-key': 'test-secret' },
    queryStringParameters: { blobKey },
  };

  const response = await handler(event as any);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  assert.equal(response.isBase64Encoded, true);
  assert.equal(Buffer.from(response.body, 'base64').toString(), bytes.toString());
});

test('admin-get-blob-pdf rejects missing blobKey', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = 'test-secret';
  const event = {
    httpMethod: 'GET',
    headers: { 'x-publish-key': 'test-secret' },
    queryStringParameters: {},
  };

  const response = await handler(event as any);
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /blobKey query parameter is required/);
});

test('admin-get-blob-pdf rejects invalid blobKey shape', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = 'test-secret';
  const event = {
    httpMethod: 'GET',
    headers: { 'x-publish-key': 'test-secret' },
    queryStringParameters: { blobKey: 'not-a-pdf-key' },
  };

  const response = await handler(event as any);
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /valid PDF artifact blobKey is required/);
});

test('admin-get-blob-pdf returns 404 for missing PDF', async () => {
  process.env.NETLIFY_PUBLISH_SECRET = 'test-secret';
  const blobKey = `pdf/missing-request/${'a'.repeat(64)}.pdf`;
  const event = {
    httpMethod: 'GET',
    headers: { 'x-publish-key': 'test-secret' },
    queryStringParameters: { blobKey },
  };

  const response = await handler(event as any);
  assert.equal(response.statusCode, 404);
  assert.match(response.body, /PDF artifact not found/);
});
