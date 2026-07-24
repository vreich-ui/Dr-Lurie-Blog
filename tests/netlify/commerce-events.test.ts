import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMERCE_EVENT_SCHEMA_VERSION,
  appendCommerceEvent,
  clientCommerceEventTypes,
  commerceEventKey,
  commerceEventSchema,
  commerceEventTypes,
  hashEmail,
  isClientCommerceEventType,
  newCommerceEvent,
} from '../../packages/core/server/lib/commerce-events.js';

const TS = '2026-07-12T12:00:00.000Z';
const EVENT_ID = '3f1b1509-5ad7-4693-ae44-e25022ab270e';

const sampleEvent = () =>
  newCommerceEvent({
    type: 'checkout_completed',
    event_id: EVENT_ID,
    ts: TS,
    actor: { email_hash: hashEmail('Buyer@Example.com ') },
    subject: { product_id: 'prod_barrier_repair_guide', session_id: 'cs_test_abc', order_id: 'ord_1' },
    context: { path: '/shop/barrier-repair-guide' },
    data: { amount_cents: 1900, currency: 'usd', mode: 'fixed' },
  });

test('commerce_event.v1: a built event carries the full envelope with explicit nulls', () => {
  const event = sampleEvent();
  assert.equal(event.schema, COMMERCE_EVENT_SCHEMA_VERSION);
  assert.equal(event.actor.anon_id, null, 'unset envelope slots are explicit nulls, never absent');
  assert.equal(event.context.referrer, null);
  assert.equal(event.context.ua, null);
  assert.deepEqual(commerceEventSchema.parse(event), event);
});

test('commerce_event.v1 REJECTION: unknown types, malformed hashes, and stray keys fail', () => {
  const event = sampleEvent();
  assert.equal(commerceEventSchema.safeParse({ ...event, type: 'refund_issued' }).success, false);
  assert.equal(
    commerceEventSchema.safeParse({ ...event, actor: { ...event.actor, email_hash: 'buyer@example.com' } }).success,
    false,
    'raw email can never sit in the actor — sha256:<hex> only (§6 PII rule)'
  );
  assert.equal(commerceEventSchema.safeParse({ ...event, buyer_email: 'x@y.z' }).success, false, 'strict envelope');
  assert.equal(commerceEventSchema.safeParse({ ...event, ts: 'yesterday' }).success, false);
});

test('hashEmail normalizes case/whitespace and emits sha256:<hex>', () => {
  const hash = hashEmail('Buyer@Example.com ');
  assert.match(hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(hash, hashEmail('buyer@example.com'), 'trim + lowercase before hashing');
  assert.notEqual(hash, hashEmail('other@example.com'));
});

test('client-authored allowlist is exactly product_viewed + checkout_started', () => {
  assert.deepEqual([...clientCommerceEventTypes], ['product_viewed', 'checkout_started']);
  for (const type of commerceEventTypes) {
    assert.equal(isClientCommerceEventType(type), type === 'product_viewed' || type === 'checkout_started', type);
  }
});

test('commerceEventKey: date directory from the event ts, digits-only time prefix, filename-safe', () => {
  const key = commerceEventKey({ ts: TS, event_id: EVENT_ID });
  assert.equal(key, `events/2026-07-12/20260712120000000-${EVENT_ID}.json`);
  assert.doesNotMatch(key, /[:.](?!json$)/, 'no colons/dots outside the extension (local FS safety)');

  const later = commerceEventKey({ ts: '2026-07-12T12:00:01.000Z', event_id: EVENT_ID });
  assert.ok(later > key, 'keys time-sort within the day');
});

test('appendCommerceEvent is create-if-absent: replays no-op, events are never overwritten', async () => {
  const blobs = new Map<string, string>();
  const store = {
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean }) {
      assert.equal(options?.onlyIfNew, true, 'writes must request the atomic create-if-absent path');
      if (blobs.has(key)) return { modified: false };
      blobs.set(key, JSON.stringify(value));
      return { modified: true };
    },
  };

  const event = sampleEvent();
  const first = await appendCommerceEvent(store, event);
  assert.equal(first.appended, true);
  assert.equal(blobs.size, 1);

  const replay = await appendCommerceEvent(store, event);
  assert.equal(replay.appended, false, 'same event replayed must no-op');
  assert.equal(replay.key, first.key);
  assert.equal(blobs.size, 1);

  // A racing writer that wins between the pre-read and the write is also a no-op.
  const racing = {
    async get() {
      return null; // pre-read sees nothing…
    },
    async setJSON() {
      return { modified: false }; // …but the atomic write reports the loss
    },
  };
  const raced = await appendCommerceEvent(racing, sampleEvent());
  assert.equal(raced.appended, false);
});
