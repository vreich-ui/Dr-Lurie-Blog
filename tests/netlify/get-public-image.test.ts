import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { handler } from '../../netlify/functions/get-public-image.js';
import { getArtifactBlobStore } from '../../netlify/lib/blob-store.js';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const setArtifactBytes = async (blobKey: string, bytes: Buffer, contentType: string) => {
  const artifactStore = await getArtifactBlobStore({});

  await artifactStore.set(blobKey, bytes, {
    metadata: {
      contentType,
      sha256: sha256(bytes),
      sizeBytes: String(bytes.byteLength),
    },
  });
};

test('get-public-image streams image artifact without admin credentials', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  // The exact key shape the canvas upload intent mints (underscored requestId).
  const requestId = 'req_canvas_page_about_20260712_01';
  const bytes = Buffer.from(`fake png bytes ${Date.now()}`);
  const blobKey = `image/${requestId}/${sha256(bytes)}.png`;
  await setArtifactBytes(blobKey, bytes, 'image/png');

  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { blobKey },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'image/png');
  assert.equal(response.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal((response as { isBase64Encoded?: boolean }).isBase64Encoded, true);
  assert.equal(Buffer.from(response.body, 'base64').toString(), bytes.toString());
});

test('get-public-image accepts clean public /img paths and maps jpg content type', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `public-image-path-${Date.now()}`;
  const bytes = Buffer.from('fake jpeg path bytes');
  const digest = sha256(bytes);
  await setArtifactBytes(`image/${requestId}/${digest}.jpg`, bytes, 'image/jpeg');

  const response = await handler({
    httpMethod: 'GET',
    path: `/img/${requestId}/${digest}.jpg`,
    queryStringParameters: null,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'image/jpeg');
  assert.equal(Buffer.from(response.body, 'base64').toString(), bytes.toString());
});

test('get-public-image accepts legacy artifacts/image blobKey values', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const requestId = `public-image-legacy-${Date.now()}`;
  const bytes = Buffer.from('fake webp legacy bytes');
  const blobKey = `image/${requestId}/${sha256(bytes)}.webp`;
  await setArtifactBytes(blobKey, bytes, 'image/webp');

  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { blobKey: `artifacts/${blobKey}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'image/webp');
  assert.equal(Buffer.from(response.body, 'base64').toString(), bytes.toString());
});

test('get-public-image rejects invalid blobKey shapes', async () => {
  for (const blobKey of [
    '../secret.png',
    'image/short-sha/abc.png',
    `pdf/request/${'a'.repeat(64)}.pdf`, // wrong kind — this route serves images only
    `image/request/${'a'.repeat(64)}.exe`, // extension outside the allowlist
    `image/request/${'a'.repeat(64)}`, // extensionless
  ]) {
    const response = await handler({
      httpMethod: 'GET',
      queryStringParameters: { blobKey },
    });

    assert.equal(response.statusCode, 400, `expected 400 for ${blobKey}`);
    assert.match(response.body, /valid image artifact blobKey/);
  }
});

test('get-public-image returns 404 for a well-formed key with no stored bytes', async () => {
  process.env.NETLIFY = 'false';
  process.env.NETLIFY_SITE_ID = '';

  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { blobKey: `image/req_canvas_missing_20260712_01/${'b'.repeat(64)}.png` },
  });

  assert.equal(response.statusCode, 404);
});

test('get-public-image rejects non-GET methods', async () => {
  const response = await handler({
    httpMethod: 'POST',
    queryStringParameters: { blobKey: `image/request/${'a'.repeat(64)}.png` },
  });

  assert.equal(response.statusCode, 405);
});
