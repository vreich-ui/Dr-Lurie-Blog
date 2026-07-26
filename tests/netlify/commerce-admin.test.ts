/**
 * commerce-admin (W5 — "agents have full access to the store administration"):
 * the bounded support-lookup reads behind the `commerce_orders` MCP tool.
 * listOrders filters by email (hash-compared, case-insensitive) and
 * product_id, sorts newest-first, caps the limit, and survives corrupt
 * records; getOrderDetail returns the full validated record or null.
 */
import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { getOrderDetail, listOrders } from '../../packages/core/server/lib/commerce-admin.js';
import { COMMERCE_ORDER_SCHEMA_VERSION, type OrderRecord } from '../../packages/core/server/lib/commerce-orders.js';

const TOKEN_HASH = `sha256:${'a'.repeat(64)}`;

const order = (overrides: Partial<OrderRecord>): OrderRecord => ({
  schema: COMMERCE_ORDER_SCHEMA_VERSION,
  order_id: 'ord_20260712_0001',
  session_id: 'cs_test_a1B2c3',
  product_id: 'prod_barrier_repair_guide',
  mode: 'fixed',
  amount_total: 1900,
  currency: 'usd',
  buyer_email: 'buyer@example.com',
  created_at: '2026-07-12T12:00:00.000Z',
  fulfillment: { state: 'issued', token_hash: TOKEN_HASH, issued_at: '2026-07-12T12:00:01.000Z', reissues: [] },
  flags: {},
  ...overrides,
});

const makeStore = (records: Record<string, unknown>) => ({
  async get(key: string) {
    const record = records[key];
    return record === undefined ? null : typeof record === 'string' ? record : JSON.stringify(record);
  },
  async list({ prefix }: { prefix: string }) {
    return {
      blobs: Object.keys(records)
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key })),
    };
  },
});

const store = makeStore({
  'orders/cs_test_a1B2c3.json': order({}),
  'orders/cs_test_d4E5f6.json': order({
    order_id: 'ord_20260712_0002',
    session_id: 'cs_test_d4E5f6',
    product_id: 'prod_support_the_work',
    mode: 'pwyw',
    amount_total: 500,
    buyer_email: 'Buyer@Example.com', // same person, different casing
    created_at: '2026-07-12T13:00:00.000Z',
  }),
  'orders/ord_20260712_0003.json': order({
    order_id: 'ord_20260712_0003',
    session_id: null,
    product_id: 'prod_starter_checklist',
    mode: 'free',
    amount_total: 0,
    buyer_email: null,
    created_at: '2026-07-12T14:00:00.000Z',
  }),
  'orders/cs_test_corrupt.json': '{"not":"an order"}', // must not kill the lookup
  'events/2026-07-12/000-x.json': order({}), // outside the orders/ prefix — never listed
});

test('listOrders: newest first, corrupt records skipped, order_key strips the path', async () => {
  const all = await listOrders(store);
  assert.deepEqual(
    all.map((summary) => summary.order_key),
    ['ord_20260712_0003', 'cs_test_d4E5f6', 'cs_test_a1B2c3']
  );
  assert.equal(all[0].buyer_email, null);
  assert.equal(all[2].fulfillment_state, 'issued');
  assert.equal(all[2].reissue_count, 0);
});

test('listOrders: email matches case-insensitively via the hash, product_id filters exactly', async () => {
  const byEmail = await listOrders(store, { email: 'BUYER@example.COM' });
  assert.deepEqual(
    byEmail.map((summary) => summary.order_key),
    ['cs_test_d4E5f6', 'cs_test_a1B2c3'],
    'both casings of the same address match; the anonymous free claim does not'
  );
  const byProduct = await listOrders(store, { product_id: 'prod_starter_checklist' });
  assert.deepEqual(
    byProduct.map((summary) => summary.order_key),
    ['ord_20260712_0003']
  );
  assert.deepEqual(await listOrders(store, { email: 'nobody@example.com' }), []);
});

test('listOrders: limit is clamped to [1, 100] and applied after the newest-first sort', async () => {
  assert.equal((await listOrders(store, { limit: 2 })).length, 2);
  assert.deepEqual(
    (await listOrders(store, { limit: 0 })).map((summary) => summary.order_key),
    ['ord_20260712_0003'],
    'limit 0 clamps to 1, keeping the newest'
  );
  assert.equal((await listOrders(store, { limit: 9999 })).length, 3);
});

test('getOrderDetail: full validated record by key; null when absent; corrupt throws', async () => {
  const detail = await getOrderDetail(store, 'cs_test_a1B2c3');
  assert.equal(detail?.order_key, 'cs_test_a1B2c3');
  assert.deepEqual(detail?.order, order({}));
  assert.equal(await getOrderDetail(store, 'cs_missing'), null);
  await assert.rejects(getOrderDetail(store, 'cs_test_corrupt'), 'detail reads validate on the way out');
});
