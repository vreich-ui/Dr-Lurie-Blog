import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { handler } from '../../netlify/functions/get-public-pdf.js';
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

test('get-public-pdf streams PDF artifact without admin credentials', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `public-pdf-stream-${Date.now()}`;
  const bytes = Buffer.from('%PDF-1.4 public pdf content');
  const blobKey = `pdf/${requestId}/${sha256(bytes)}.pdf`;
  await setArtifactBytes(blobKey, bytes);

  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { blobKey },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  assert.equal((response as { isBase64Encoded?: boolean }).isBase64Encoded, true);
  assert.equal(Buffer.from(response.body, 'base64').toString(), bytes.toString());
});

test('get-public-pdf accepts clean public PDF paths', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `public-pdf-path-${Date.now()}`;
  const bytes = Buffer.from('%PDF-1.4 public path pdf content');
  const blobKey = `pdf/${requestId}/${sha256(bytes)}.pdf`;
  await setArtifactBytes(blobKey, bytes);

  const response = await handler({
    httpMethod: 'GET',
    path: `/${blobKey}`,
    queryStringParameters: null,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'application/pdf');
  assert.match(response.headers['Content-Disposition'], /^attachment; filename=/);
  assert.equal(Buffer.from(response.body, 'base64').toString(), bytes.toString());
});

test('get-public-pdf accepts legacy artifacts/pdf blobKey values', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `public-pdf-legacy-${Date.now()}`;
  const bytes = Buffer.from('%PDF-1.4 public legacy pdf content');
  const blobKey = `pdf/${requestId}/${sha256(bytes)}.pdf`;
  await setArtifactBytes(blobKey, bytes);

  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { blobKey: `artifacts/${blobKey}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(Buffer.from(response.body, 'base64').toString(), bytes.toString());
});

test('get-public-pdf rejects invalid blobKey shape', async () => {
  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { blobKey: '../secret.pdf' },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.body, /valid PDF artifact blobKey/);
});
