/**
 * T13.9 — mirror-replay core (scripts/lib/tracking-replay.mjs). Pins:
 * date-range expansion (inclusive, validated, bounded), in-run event_id
 * dedupe + id-less drops, order-preserving batch planning, NDJSON shape,
 * dry-run-by-default posting NOTHING, abort on a non-202 sink answer, and
 * the idempotent re-run story (same events → same posts; the sink's UNIQUE
 * event_id absorbs them).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { datesInRange, dedupeEvents, planBatches, replayEvents, toNdjson } from '../../scripts/lib/tracking-replay.mjs';

const event = (id, extra = {}) => ({ event_id: id, event: 'pageview', ...extra });

test('datesInRange: inclusive, validated, bounded to a year', () => {
  assert.deepEqual(datesInRange('2026-07-19', '2026-07-19'), ['2026-07-19']);
  assert.deepEqual(datesInRange('2026-07-30', '2026-08-02'), ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);
  assert.throws(() => datesInRange('2026-7-1', '2026-07-02'), /yyyy-mm-dd/);
  assert.throws(() => datesInRange('2026-07-02', '2026-07-01'), /invalid range/);
  assert.throws(() => datesInRange('2020-01-01', '2026-01-01'), /longer than a year/);
});

test('dedupeEvents: in-run duplicates skipped, id-less entries dropped, order preserved', () => {
  const { kept, dropped, duplicates } = dedupeEvents([
    event('a'),
    event('b'),
    event('a'),
    { event: 'pageview' },
    event('c'),
  ]);
  assert.deepEqual(
    kept.map((entry) => entry.event_id),
    ['a', 'b', 'c']
  );
  assert.equal(duplicates, 1);
  assert.equal(dropped, 1);
});

test('planBatches slices order-preserving; toNdjson emits one JSON line per event', () => {
  const events = ['a', 'b', 'c', 'd', 'e'].map((id) => event(id));
  const batches = planBatches(events, 2);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [2, 2, 1]
  );
  assert.equal(batches[0][0].event_id, 'a');
  const body = toNdjson(batches[0]);
  const lines = body.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).event_id, 'b');
  assert.ok(body.endsWith('\n'));
});

test('dry-run (the default) posts NOTHING and reports the full plan', async () => {
  const posts = [];
  const summary = await replayEvents([event('a'), event('b'), event('a')], {
    post: async (body) => {
      posts.push(body);
      return { ok: true, status: 202 };
    },
    batchSize: 1,
  });
  assert.equal(posts.length, 0, 'dry-run never touches the sink');
  assert.deepEqual(summary, { events: 2, dropped: 0, duplicates: 1, batches: 2, posted: 0, dryRun: true });
});

test('execute posts NDJSON batches in order; a re-run posts identically (sink-side idempotent)', async () => {
  const runOnce = async () => {
    const received = [];
    const summary = await replayEvents(
      ['a', 'b', 'c'].map((id) => event(id)),
      {
        post: async (body) => {
          received.push(
            ...body
              .trimEnd()
              .split('\n')
              .map((line) => JSON.parse(line).event_id)
          );
          return { ok: true, status: 202 };
        },
        batchSize: 2,
        dryRun: false,
      }
    );
    return { received, summary };
  };
  const first = await runOnce();
  assert.deepEqual(first.received, ['a', 'b', 'c']);
  assert.equal(first.summary.posted, 2);
  const second = await runOnce();
  assert.deepEqual(second.received, first.received, 'idempotent re-run: same events, same order — the sink dedupes');
});

test('a non-202 sink answer aborts with a resumable message', async () => {
  let calls = 0;
  await assert.rejects(
    replayEvents(
      ['a', 'b', 'c', 'd'].map((id) => event(id)),
      {
        post: async () => ({ ok: false, status: ++calls === 2 ? 500 : 202 }),
        batchSize: 2,
        dryRun: false,
      }
    ),
    /sink answered 500 after 1 posted batch\(es\).*re-run/
  );
  assert.equal(calls, 2, 'stops at the failing batch — at-most-once, the mirror still holds everything');
});
