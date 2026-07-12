import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMERCE_ORDER_SCHEMA_VERSION,
  orderIdempotencyKey,
  orderKey,
  orderRecordSchema,
  readOrder,
  writeOrderIfAbsent,
  type OrderRecord,
} from '../../netlify/lib/commerce-orders.js';

const TOKEN_HASH = `sha256:${'a'.repeat(64)}`;

const paidOrder = (): OrderRecord => ({
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
});

const freeOrder = (): OrderRecord => ({
  ...paidOrder(),
  order_id: 'ord_20260712_0002',
  session_id: null, // free claims never touch Stripe (§5)
  mode: 'free',
  amount_total: 0,
});

test('commerce_order.v1: paid and free shapes parse; the raw email lives here by design', () => {
  assert.deepEqual(orderRecordSchema.parse(paidOrder()), paidOrder());
  assert.deepEqual(orderRecordSchema.parse(freeOrder()), freeOrder());
});

test('commerce_order.v1 REJECTION: raw tokens, non-integer amounts, stray keys', () => {
  const order = paidOrder();
  assert.equal(
    orderRecordSchema.safeParse({
      ...order,
      fulfillment: { ...order.fulfillment, token_hash: 'tok_plaintext' },
    }).success,
    false,
    'only sha256 hashes of tokens are ever stored'
  );
  assert.equal(orderRecordSchema.safeParse({ ...order, amount_total: 19.5 }).success, false);
  assert.equal(orderRecordSchema.safeParse({ ...order, stripe_secret: 'sk_x' }).success, false);
  assert.equal(
    orderRecordSchema.safeParse({
      ...order,
      fulfillment: { ...order.fulfillment, reissues: [{ at: 'not-a-date', token_hash: TOKEN_HASH }] },
    }).success,
    false
  );
});

test('orderKey/orderIdempotencyKey: session id for paid orders, order id for free claims', () => {
  assert.equal(orderIdempotencyKey(paidOrder()), 'cs_test_a1B2c3');
  assert.equal(orderIdempotencyKey(freeOrder()), 'ord_20260712_0002');
  assert.equal(orderKey('cs_test_a1B2c3'), 'orders/cs_test_a1B2c3.json');
  assert.throws(() => orderKey(''), /invalid idempotency key/);
  assert.throws(() => orderKey('../escape'), /invalid idempotency key/);
});

const makeStore = () => {
  const blobs = new Map<string, string>();
  return {
    blobs,
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean }) {
      assert.equal(options?.onlyIfNew, true, 'order writes must request atomic create-if-absent');
      if (blobs.has(key)) return { modified: false };
      blobs.set(key, JSON.stringify(value));
      return { modified: true };
    },
  };
};

test('writeOrderIfAbsent: the webhook idempotency mechanism — replays return the ORIGINAL order', async () => {
  const store = makeStore();
  const first = await writeOrderIfAbsent(store, paidOrder());
  assert.equal(first.created, true);
  assert.equal(first.key, 'orders/cs_test_a1B2c3.json');

  // A Stripe double-fire replays the same session with (say) a later-issued
  // token attempt — the stored record must not move.
  const replayAttempt = {
    ...paidOrder(),
    fulfillment: { state: 'issued' as const, token_hash: `sha256:${'b'.repeat(64)}`, issued_at: null, reissues: [] },
  };
  const replay = await writeOrderIfAbsent(store, replayAttempt);
  assert.equal(replay.created, false);
  assert.deepEqual(replay.order, paidOrder(), 'the FIRST write wins; replays read it back');
  assert.equal(store.blobs.size, 1);
});

test('writeOrderIfAbsent: losing the atomic race reads the winner back', async () => {
  const winner = paidOrder();
  const store = {
    raced: false,
    async get(_key: string) {
      // Pre-read misses; post-race read finds the winner.
      return this.raced ? JSON.stringify(winner) : ((this.raced = true), null);
    },
    async setJSON() {
      return { modified: false };
    },
  };
  const result = await writeOrderIfAbsent(store, { ...winner, buyer_email: 'loser@example.com' });
  assert.equal(result.created, false);
  assert.deepEqual(result.order, winner);
});

test('readOrder validates on the way out and returns null for absent keys', async () => {
  const store = makeStore();
  await writeOrderIfAbsent(store, freeOrder());
  const loaded = await readOrder(store, 'ord_20260712_0002');
  assert.deepEqual(loaded, freeOrder());
  assert.equal(await readOrder(store, 'cs_missing'), null);
});
