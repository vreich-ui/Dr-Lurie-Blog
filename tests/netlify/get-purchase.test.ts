import assert from 'node:assert/strict';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { setLocalBlobsRootForTesting, createLocalBlobStore } from '../../netlify/lib/local-blobs.js';

const LOCAL_BLOBS_ROOT = join(process.cwd(), '.netlify', 'local-blobs-test', 'get-purchase');
setLocalBlobsRootForTesting(LOCAL_BLOBS_ROOT);

for (const key of ['NETLIFY', 'NETLIFY_SITE_ID', 'NETLIFY_BLOBS_TOKEN', 'NETLIFY_AUTH_TOKEN', 'SITE_ID']) {
  delete process.env[key];
}
const SECRET = 'purchase-token-secret-0123456789abcdef';
process.env.PURCHASE_TOKEN_SECRET = SECRET;

const { handler } = await import('../../netlify/functions/get-purchase.js');
const { mintPurchaseToken } = await import('../../netlify/lib/purchase-tokens.js');
const { objectRecordKey } = await import('../../netlify/lib/object-store-keys.js');

const SESSION_ID = 'cs_test_a1B2c3d4';
const PRODUCT_ID = 'prod_barrier_repair_guide';
const ARTIFACT_REF = 'pdf/guides/2f4d1b6f9d1e4c1a8e1b3c5d7f9a1b2c3d4e5f60718293a4b5c6d7e8f9012345.pdf';
const PDF_BYTES = '%PDF-1.7 test-bytes';

const seed = async () => {
  await rm(LOCAL_BLOBS_ROOT, { recursive: true, force: true });
  await createLocalBlobStore('artifacts').set(ARTIFACT_REF, PDF_BYTES);
  await createLocalBlobStore('commerce').setJSON(`orders/${SESSION_ID}.json`, {
    schema: 'commerce_order.v1',
    order_id: 'ord_abc123def456',
    session_id: SESSION_ID,
    product_id: PRODUCT_ID,
    mode: 'fixed',
    amount_total: 1900,
    currency: 'usd',
    buyer_email: 'buyer@example.com',
    created_at: '2026-07-12T12:00:00.000Z',
    fulfillment: { state: 'issued', token_hash: `sha256:${'a'.repeat(64)}`, issued_at: null, reissues: [] },
    flags: {},
  });
  await createLocalBlobStore('site-objects').setJSON(objectRecordKey('product', PRODUCT_ID), {
    object_id: PRODUCT_ID,
    object_type: 'product',
    status: 'active',
    publication: { published_time: '2026-07-12T00:00:00.000Z' },
    body: {
      slug: 'barrier-repair-guide',
      presentation: { title: 'The Barrier Repair Guide' },
      commerce: {
        provider: 'stripe',
        mode: 'fixed',
        price: { amount_cents: 1900, currency: 'usd' },
        stripe: { product_id: 'prod_Live1', price_id: 'price_Live1' },
        availability: 'available',
      },
      fulfillment: { kind: 'download', artifact_ref: ARTIFACT_REF, filename: 'barrier-repair-guide.pdf' },
    },
  });
};

const get = (token?: string) =>
  handler({ httpMethod: 'GET', queryStringParameters: token === undefined ? {} : { token } });

const freshToken = (overrides: Partial<{ order_key: string; artifact_ref: string; exp: number }> = {}) =>
  mintPurchaseToken(
    { order_key: SESSION_ID, artifact_ref: ARTIFACT_REF, exp: Date.now() + 60_000, ...overrides },
    SECRET
  );

test('a valid token streams the private artifact as an attachment and logs download_succeeded', async () => {
  await seed();
  const response = await get(freshToken());
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['Content-Type'], 'application/pdf');
  assert.equal(response.headers?.['Cache-Control'], 'no-store');
  assert.equal(response.headers?.['Content-Disposition'], 'attachment; filename="barrier-repair-guide.pdf"');
  assert.equal(Buffer.from(String(response.body), 'base64').toString('utf8'), PDF_BYTES);

  const eventDirs = await readdir(join(LOCAL_BLOBS_ROOT, 'commerce-events', 'events'));
  assert.equal(eventDirs.length, 1, 'download_succeeded event appended');
});

test('the failure ladder: 405 / 400 / 401 / 410 / 404, each without leaking bytes', async () => {
  await seed();
  assert.equal((await handler({ httpMethod: 'POST' })).statusCode, 405);
  assert.equal((await get()).statusCode, 400);
  assert.equal((await get('not-a-token')).statusCode, 401);
  assert.equal((await get(`${freshToken()}tampered`)).statusCode, 401);
  assert.equal((await get(freshToken({ exp: Date.now() - 1 }))).statusCode, 410, 'expired = Gone + reissue hint');
  assert.equal((await get(freshToken({ order_key: 'cs_test_ghost' }))).statusCode, 404, 'no order, no bytes');
});

test('without PURCHASE_TOKEN_SECRET the endpoint is 503, never a weak fallback', async () => {
  await seed();
  const saved = process.env.PURCHASE_TOKEN_SECRET;
  delete process.env.PURCHASE_TOKEN_SECRET;
  try {
    assert.equal((await get(freshToken())).statusCode, 503);
  } finally {
    process.env.PURCHASE_TOKEN_SECRET = saved;
  }
});
