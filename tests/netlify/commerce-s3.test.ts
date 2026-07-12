/**
 * S3 coverage: the set_product_price op (grammar + apply/inverse), the
 * product_set_price and order_reissue tool libs, and the claim-free path —
 * criterion-4 completeness for the product type.
 */
import assert from 'node:assert/strict';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { setLocalBlobsRootForTesting, createLocalBlobStore } from '../../netlify/lib/local-blobs.js';

const LOCAL_BLOBS_ROOT = join(process.cwd(), '.netlify', 'local-blobs-test', 'commerce-s3');
setLocalBlobsRootForTesting(LOCAL_BLOBS_ROOT);
for (const key of ['NETLIFY', 'NETLIFY_SITE_ID', 'NETLIFY_BLOBS_TOKEN', 'NETLIFY_AUTH_TOKEN', 'SITE_ID']) {
  delete process.env[key];
}
process.env.STRIPE_MODE = 'test';
process.env.PURCHASE_TOKEN_SECRET = 'purchase-token-secret-0123456789abcdef';

const { patchOpSchema } = await import('../../src/schema/object-patch-ops.js');
const { applyPatchOps, derivePatchInverse } = await import('../../src/lib/object-patch-apply.js');
const { productSetPrice } = await import('../../netlify/lib/product-set-price.js');
const { orderReissue } = await import('../../netlify/lib/order-reissue.js');
const { verifyPurchaseToken } = await import('../../netlify/lib/purchase-tokens.js');
const { handler: claimFree } = await import('../../netlify/functions/claim-free.js');
const { objectRecordKey } = await import('../../netlify/lib/object-store-keys.js');
const { orderRecordSchema } = await import('../../netlify/lib/commerce-orders.js');
import type { ObjectRecord, Principal } from '../../src/schema/object-record-v1.js';
import type { ObjectVerbStore } from '../../netlify/lib/object-verbs.js';
import type Stripe from 'stripe';

const AGENT: Principal = { kind: 'agent', agent_name: 's3-test', auth: 'publish_key' };
const PRODUCT_ID = 'prod_barrier_repair_guide';
const ARTIFACT_REF = 'pdf/guides/2f4d1b6f9d1e4c1a8e1b3c5d7f9a1b2c3d4e5f60718293a4b5c6d7e8f9012345.pdf';

const fixedBody = () => ({
  slug: 'barrier-repair-guide',
  presentation: { title: 'The Barrier Repair Guide' },
  commerce: {
    provider: 'stripe',
    mode: 'fixed',
    price: { amount_cents: 1900, currency: 'usd' },
    stripe_test: { product_id: 'prod_Test1', price_id: 'price_Old1' },
    availability: 'available',
  },
  fulfillment: { kind: 'download', artifact_ref: ARTIFACT_REF, filename: 'barrier-repair-guide.pdf' },
});

const productRecord = (body: unknown = fixedBody()): ObjectRecord => ({
  object_id: PRODUCT_ID,
  object_type: 'product',
  schema_version: 'product.v1',
  site: 'site_drlurie',
  created_at: '2026-07-12T00:00:00.000Z',
  updated_at: '2026-07-12T00:00:00.000Z',
  status: 'active',
  body,
  publication: { published_time: '2026-07-12T00:00:00.000Z' },
  history: [],
  version: 3,
  content_revision: 1,
});

// ─── the set_product_price op: grammar + apply + inverse ─────────────────────

test('set_product_price: only the funnel keys are expressible; apply + inverse round-trip exactly', () => {
  assert.equal(
    patchOpSchema.safeParse({
      op: 'set_product_price',
      fields: { commerce: { price: { amount_cents: 2400, currency: 'usd' }, presentation: { title: 'X' } } },
    }).success,
    false,
    'non-funnel keys are unrepresentable'
  );
  assert.equal(
    patchOpSchema.safeParse({ op: 'set_product_price', fields: { slug: 'x' } }).success,
    false,
    'only commerce is patchable'
  );

  const forward = {
    op: 'set_product_price',
    fields: {
      commerce: {
        price: { amount_cents: 2400, currency: 'usd' },
        stripe_test: { product_id: 'prod_Test1', price_id: 'price_New1' },
      },
    },
  };
  const record = productRecord();
  const applied = applyPatchOps(record, [forward], { actor: AGENT, at: '2026-07-12T12:00:00.000Z' });
  const patchedCommerce = (applied.record.body as ReturnType<typeof fixedBody>).commerce;
  assert.equal(patchedCommerce.price.amount_cents, 2400);
  assert.equal(patchedCommerce.stripe_test.price_id, 'price_New1');

  // Inverse = re-point to the archived price (§3): same op, captured before.
  const inverse = derivePatchInverse(applied.applied[0].op, applied.applied[0].capture);
  assert.equal(inverse.op, 'set_product_price');
  const reverted = applyPatchOps(applied.record, [inverse], { actor: AGENT, at: '2026-07-12T12:01:00.000Z' });
  assert.deepEqual(reverted.record.body, record.body, 'discard restores the old price_id + cache exactly');
});

// ─── product_set_price lib ───────────────────────────────────────────────────

const seedProductRecord = async (body: unknown = fixedBody()) => {
  await rm(LOCAL_BLOBS_ROOT, { recursive: true, force: true });
  const store = createLocalBlobStore('site-objects') as unknown as ObjectVerbStore;
  await store.setJSON(objectRecordKey('product', PRODUCT_ID), productRecord(body));
  return store;
};

const fakeStripe = () => {
  const calls: Record<string, unknown[]> = { pricesCreate: [], pricesUpdate: [], productsCreate: [] };
  const client = {
    prices: {
      create: async (params: unknown) => {
        calls.pricesCreate.push(params);
        return { id: 'price_New1' };
      },
      update: async (id: string, params: unknown) => {
        calls.pricesUpdate.push([id, params]);
        return { id };
      },
    },
    products: {
      create: async (params: unknown) => {
        calls.productsCreate.push(params);
        return { id: 'prod_Minted1' };
      },
    },
  } as unknown as Stripe;
  return { client, calls };
};

test('product_set_price: creates the new Price, archives the old, writes cache + linkage in one governed patch', async () => {
  const store = await seedProductRecord();
  const { client, calls } = fakeStripe();
  const result = await productSetPrice(
    { product_id: PRODUCT_ID, amount_cents: 2400 },
    { stripe: client, store, principal: AGENT }
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.ok && result.stripe.price_id, 'price_New1');
  assert.equal(result.ok && result.stripe.archived_price_id, 'price_Old1');
  assert.deepEqual(calls.pricesCreate, [{ product: 'prod_Test1', unit_amount: 2400, currency: 'usd' }]);
  assert.deepEqual(calls.pricesUpdate, [['price_Old1', { active: false }]]);
  assert.equal(calls.productsCreate.length, 0, 'existing linkage reuses the Stripe Product');

  const stored = JSON.parse((await store.get(objectRecordKey('product', PRODUCT_ID))) ?? 'null') as ObjectRecord;
  const commerce = (stored.body as ReturnType<typeof fixedBody>).commerce;
  assert.equal(commerce.price.amount_cents, 2400, 'display cache = what was just created in Stripe');
  assert.equal(commerce.stripe_test.price_id, 'price_New1');
  assert.equal(stored.publication.published_time, '2026-07-12T00:00:00.000Z', 'NOT republished — §0.4 gate untouched');
  assert.ok(
    stored.history.some((entry) => entry.action === 'set_product_price'),
    'audited'
  );
});

test('product_set_price: bootstraps a Stripe Product for unlinked products; refuses pwyw', async () => {
  const unlinked = { ...fixedBody(), commerce: { ...fixedBody().commerce, stripe_test: undefined } };
  const store = await seedProductRecord(unlinked);
  const { client, calls } = fakeStripe();
  const result = await productSetPrice(
    { product_id: PRODUCT_ID, amount_cents: 900 },
    { stripe: client, store, principal: AGENT }
  );
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(calls.productsCreate, [{ name: 'The Barrier Repair Guide' }]);
  assert.equal(result.ok && result.stripe.product_id, 'prod_Minted1');

  const pwyw = {
    ...fixedBody(),
    commerce: {
      provider: 'stripe',
      mode: 'pwyw',
      pwyw: { min_cents: 300 },
      stripe_test: { product_id: 'prod_Test1' },
      availability: 'available',
    },
  };
  const store2 = await seedProductRecord(pwyw);
  const refused = await productSetPrice(
    { product_id: PRODUCT_ID, amount_cents: 900 },
    { stripe: fakeStripe().client, store: store2, principal: AGENT }
  );
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.status, 409, 'pwyw has no Stripe Price by design (§3)');
});

// ─── order_reissue lib ───────────────────────────────────────────────────────

const seedOrder = async (overrides: Record<string, unknown> = {}) => {
  const commerce = createLocalBlobStore('commerce');
  const order = {
    schema: 'commerce_order.v1',
    order_id: 'ord_abc123def456',
    session_id: 'cs_test_a1B2c3',
    product_id: PRODUCT_ID,
    mode: 'fixed',
    amount_total: 1900,
    currency: 'usd',
    buyer_email: 'buyer@example.com',
    created_at: '2026-07-12T12:00:00.000Z',
    fulfillment: {
      state: 'issued',
      token_hash: `sha256:${'a'.repeat(64)}`,
      issued_at: '2026-07-12T12:00:01.000Z',
      artifact_ref: ARTIFACT_REF,
      reissues: [],
    },
    flags: {},
    ...overrides,
  };
  await commerce.setJSON('orders/cs_test_a1B2c3.json', order);
  return commerce;
};

test('order_reissue: mints a working link from the ORDER record alone, audited + evented', async () => {
  const store = await seedProductRecord();
  void store;
  const commerce = await seedOrder();
  const events = createLocalBlobStore('commerce-events');
  const result = await orderReissue(
    { order_key: 'cs_test_a1B2c3' },
    { commerce, events, siteObjects: createLocalBlobStore('site-objects'), by: 'support-agent' }
  );
  assert.ok(result.ok, JSON.stringify(result));
  const token = decodeURIComponent((result.ok && result.download_url.split('token=')[1]) || '');
  const verified = verifyPurchaseToken(token, 'purchase-token-secret-0123456789abcdef');
  assert.ok(verified.ok && verified.payload.artifact_ref === ARTIFACT_REF, 'no Stripe, no product read needed');

  const stored = orderRecordSchema.parse(JSON.parse((await commerce.get('orders/cs_test_a1B2c3.json')) ?? 'null'));
  assert.equal(stored.fulfillment.reissues.length, 1);
  assert.equal(stored.fulfillment.reissues[0].by, 'support-agent');
  assert.match(stored.fulfillment.reissues[0].token_hash, /^sha256:[0-9a-f]{64}$/);

  const eventDays = await readdir(join(LOCAL_BLOBS_ROOT, 'commerce-events', 'events'));
  assert.equal(eventDays.length, 1, 'fulfillment_reissued appended');
});

test('order_reissue: unknown orders 404; undeliverable orders 409; ttl is bounded', async () => {
  await seedProductRecord();
  const commerce = await seedOrder();
  const events = createLocalBlobStore('commerce-events');
  const siteObjects = createLocalBlobStore('site-objects');

  assert.equal((await orderReissue({ order_key: 'cs_ghost' }, { commerce, events, siteObjects, by: 'x' })).ok, false);
  assert.equal(
    (await orderReissue({ order_key: 'cs_test_a1B2c3', ttl_hours: 0.5 }, { commerce, events, siteObjects, by: 'x' }))
      .ok,
    false,
    'sub-hour ttl refused'
  );

  // A tip order (state none, no artifact anywhere) has nothing to reissue.
  await commerce.setJSON('orders/cs_test_tip.json', {
    ...JSON.parse((await commerce.get('orders/cs_test_a1B2c3.json')) ?? 'null'),
    session_id: 'cs_test_tip',
    product_id: 'prod_ghost_tip',
    fulfillment: { state: 'none', token_hash: null, issued_at: null, reissues: [] },
  });
  const tip = await orderReissue({ order_key: 'cs_test_tip' }, { commerce, events, siteObjects, by: 'x' });
  assert.equal(tip.ok, false);
  assert.equal(!tip.ok && tip.status, 409);
});

// ─── claim-free ──────────────────────────────────────────────────────────────

test('claim-free: a free product issues order + token + events + opt-in in one call; paid products refuse', async () => {
  const freeBody = {
    slug: 'starter-checklist',
    presentation: { title: 'The Skincare Starter Checklist' },
    commerce: { provider: 'none', mode: 'free', availability: 'available' },
    fulfillment: { kind: 'download', artifact_ref: ARTIFACT_REF, filename: 'starter-checklist.pdf' },
  };
  await rm(LOCAL_BLOBS_ROOT, { recursive: true, force: true });
  await createLocalBlobStore('site-objects').setJSON(
    objectRecordKey('product', 'prod_starter_checklist'),
    productRecord(freeBody)
  );

  const response = await claimFree({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ product_id: 'prod_starter_checklist', email: 'Reader@Example.com' }),
  });
  assert.equal(response.statusCode, 200, response.body);
  const payload = JSON.parse(response.body) as { order_id: string; download: { url: string; filename: string } };
  assert.match(payload.order_id, /^ord_free_[0-9a-f]{12}$/);
  assert.equal(payload.download.filename, 'starter-checklist.pdf');

  const commerce = createLocalBlobStore('commerce');
  const stored = orderRecordSchema.parse(JSON.parse((await commerce.get(`orders/${payload.order_id}.json`)) ?? 'null'));
  assert.equal(stored.session_id, null, 'free claims never touch Stripe');
  assert.equal(stored.amount_total, 0);
  assert.equal(stored.buyer_email, 'Reader@Example.com', 'raw email lives in the order record only');
  assert.equal(stored.fulfillment.artifact_ref, ARTIFACT_REF);

  const eventDays = await readdir(join(LOCAL_BLOBS_ROOT, 'commerce-events', 'events'));
  assert.equal(eventDays.length, 1, 'checkout_completed + fulfillment_issued appended');
  const optIns = await readdir(join(LOCAL_BLOBS_ROOT, 'opt-ins', 'opt-ins'));
  assert.equal(optIns.length, 1, 'the lead-capture tie-in recorded the email');

  // A fixed-price product is never claimable.
  await createLocalBlobStore('site-objects').setJSON(objectRecordKey('product', PRODUCT_ID), productRecord());
  const refused = await claimFree({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ product_id: PRODUCT_ID }),
  });
  assert.equal(refused.statusCode, 409);
});
