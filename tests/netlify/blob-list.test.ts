import assert from 'node:assert/strict';
import test from 'node:test';

import { mapWithConcurrency, STORE_READ_CONCURRENCY } from '../../packages/core/server/lib/blob-list.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('mapWithConcurrency preserves input order even when items resolve out of order', async () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7];
  // Reverse-delay: item 0 finishes LAST, item 7 finishes FIRST.
  const order: number[] = [];
  const results = await mapWithConcurrency(items, 4, async (item) => {
    await delay((items.length - item) * 5);
    order.push(item);
    return item * 10;
  });

  assert.deepEqual(results, [0, 10, 20, 30, 40, 50, 60, 70], 'output must be positionally aligned to input');
  // Sanity: confirm the async work really did complete out of order (otherwise
  // this test would trivially pass even with a naive sequential map).
  assert.notDeepEqual(order, items, 'items should not have resolved in input order');
});

test('mapWithConcurrency: concurrency limit is respected (no more than `limit` in flight)', async () => {
  const limit = 3;
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 12 }, (_, i) => i);

  await mapWithConcurrency(items, limit, async (item) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await delay(5);
    inFlight -= 1;
    return item;
  });

  assert.ok(maxInFlight <= limit, `expected at most ${limit} concurrent, saw ${maxInFlight}`);
});

test('mapWithConcurrency: empty input resolves to an empty array', async () => {
  const results = await mapWithConcurrency([], STORE_READ_CONCURRENCY, async (x) => x);
  assert.deepEqual(results, []);
});

test('mapWithConcurrency: a single item still resolves correctly', async () => {
  const results = await mapWithConcurrency(['only'], STORE_READ_CONCURRENCY, async (x) => `${x}!`);
  assert.deepEqual(results, ['only!']);
});

test('mapWithConcurrency: STORE_READ_CONCURRENCY is a sane positive bound', () => {
  assert.ok(Number.isInteger(STORE_READ_CONCURRENCY) && STORE_READ_CONCURRENCY > 0);
});
