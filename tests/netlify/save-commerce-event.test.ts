import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import { rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { handler } from '../../netlify/functions/save-commerce-event.js';
import { setLocalBlobsRootForTesting } from '../../packages/core/server/lib/local-blobs.js';

// Isolated local-blobs root (the established per-suite idiom — sibling suites
// run concurrently and must not share an on-disk store).
const LOCAL_BLOBS_ROOT = join(process.cwd(), '.netlify', 'local-blobs-test', 'save-commerce-event');
setLocalBlobsRootForTesting(LOCAL_BLOBS_ROOT);

// The local file-backed fallback must be the store in use (blob-store.ts
// checks these at call time).
for (const key of ['NETLIFY', 'NETLIFY_SITE_ID', 'NETLIFY_BLOBS_TOKEN', 'NETLIFY_AUTH_TOKEN', 'SITE_ID']) {
  delete process.env[key];
}

const EVENTS_DIR = join(LOCAL_BLOBS_ROOT, 'commerce-events');
const reset = () => rm(EVENTS_DIR, { recursive: true, force: true });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  handler({
    httpMethod: 'POST',
    headers: { 'user-agent': 'node-test-agent', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('non-POST and malformed bodies are rejected', async () => {
  await reset();
  assert.equal((await handler({ httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await handler({ httpMethod: 'POST', body: null })).statusCode, 400);
  assert.equal((await post('not-json{')).statusCode, 400);
  assert.equal((await post([1, 2, 3])).statusCode, 400);
});

test('server-authored event types cannot be forged through the public endpoint', async () => {
  await reset();
  for (const type of ['checkout_completed', 'fulfillment_issued', 'amount_mismatch', 'made_up']) {
    const response = await post({ type, product_id: 'prod_barrier_repair_guide' });
    assert.equal(response.statusCode, 400, type);
  }
});

test('a malformed product_id is rejected (shape only — best-effort endpoint, no store lookup)', async () => {
  await reset();
  const response = await post({ type: 'product_viewed', product_id: 'sku-123' });
  assert.equal(response.statusCode, 400);
});

test('product_viewed beacon → 202, full envelope written, data allowlisted, no email accepted', async () => {
  await reset();
  const response = await post({
    type: 'checkout_started',
    product_id: 'prod_barrier_repair_guide',
    anon_id: 'a_visitor1',
    path: '/shop/barrier-repair-guide',
    referrer: 'https://example.com/',
    email: 'sneaky@example.com', // must be ignored — raw email never enters the event log
    data: { amount_cents: 1900, currency: 'usd', mode: 'fixed', card_number: '4242' },
  });
  assert.equal(response.statusCode, 202);
  const { key, ok } = JSON.parse(response.body) as { key: string; ok: boolean };
  assert.equal(ok, true);
  assert.match(key, /^events\/\d{4}-\d{2}-\d{2}\/\d{17}-[0-9a-f-]{36}\.json$/);

  const written = JSON.parse(await readFile(join(EVENTS_DIR, key), 'utf8')) as Record<string, unknown>;
  assert.equal(written.schema, 'commerce_event.v1');
  assert.equal(written.type, 'checkout_started');
  assert.deepEqual(written.subject, { product_id: 'prod_barrier_repair_guide', order_id: null, session_id: null });
  assert.deepEqual(written.actor, { anon_id: 'a_visitor1', email_hash: null });
  assert.deepEqual(written.data, { amount_cents: 1900, currency: 'usd', mode: 'fixed' }, 'card_number dropped');
  const context = written.context as Record<string, unknown>;
  assert.equal(context.ua, 'node-test-agent');
  assert.equal(context.path, '/shop/barrier-repair-guide');
  assert.equal(JSON.stringify(written).includes('sneaky@example.com'), false, 'no raw email anywhere');
});

test('sendBeacon reality: JSON parses regardless of content-type; base64 bodies decode', async () => {
  await reset();
  const asText = await post(
    { type: 'product_viewed', product_id: 'prod_barrier_repair_guide' },
    { 'content-type': 'text/plain;charset=UTF-8' }
  );
  assert.equal(asText.statusCode, 202);

  const base64 = await handler({
    httpMethod: 'POST',
    headers: {},
    isBase64Encoded: true,
    body: Buffer.from(JSON.stringify({ type: 'product_viewed', product_id: 'prod_barrier_repair_guide' })).toString(
      'base64'
    ),
  });
  assert.equal(base64.statusCode, 202);
});
