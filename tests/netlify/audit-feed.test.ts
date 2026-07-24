/**
 * T9.11 — audit feed + attention inbox pure aggregation. Pins:
 *   - the feed flattens history newest-first, phrases entries as human
 *     sentences (verbToPhrase), and skips malformed entries without throwing;
 *   - the inbox surfaces open reviews, unpublished ACTIVE changes, and held
 *     locks (never the lock token), oldest lock first;
 *   - stats count published / in-review / unpublished / locked;
 *   - a corrupt record can never break the sweep.
 */
import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAuditFeed, buildAttentionInbox } from '../../packages/core/server/lib/audit-feed.js';
import type { ObjectRecord } from '../../packages/core/schema/object-record-v1.js';

const NOW = Date.parse('2026-07-17T12:00:00.000Z');

const HUMAN = { kind: 'human' as const, id: 'u1', email: 'wolf.reich@example.com' };
const AGENT = { kind: 'agent' as const, agent_name: 'draft_writer', auth: 'publish_key' as const };

const baseRecord = (overrides: Partial<ObjectRecord> = {}): ObjectRecord => ({
  object_id: 'page_home',
  object_type: 'page',
  schema_version: 'page.v1',
  site: 'site_drlurie',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-10T00:00:00.000Z',
  status: 'active',
  body: { title: 'Start Here', route: '/', pageType: 'home' },
  publication: { published_time: null },
  history: [],
  version: 1,
  content_revision: 1,
  ...overrides,
});

const heldLock = (over: Record<string, unknown> = {}) => ({
  token: 'secret-token',
  owner_id: 'editor-1',
  owner_label: 'editor@example.com',
  acquired_at: '2026-07-17T11:50:00.000Z',
  expires_at: '2026-07-17T12:05:00.000Z',
  ...over,
});

// ═══ activity feed ════════════════════════════════════════════════════════════

test('feed flattens history newest-first as human phrases with the object name resolved', () => {
  const records = [
    baseRecord({
      object_id: 'page_home',
      body: { title: 'Start Here' },
      history: [
        { at: '2026-07-17T09:00:00.000Z', action: 'create', actor: HUMAN },
        { at: '2026-07-17T11:30:00.000Z', action: 'publish', actor: AGENT },
      ],
    }),
    baseRecord({
      object_id: 'content_launch',
      object_type: 'content_item',
      body: { title: 'Launch Note' },
      history: [{ at: '2026-07-17T10:00:00.000Z', action: 'patch', actor: HUMAN }],
    }),
  ];

  const feed = buildAuditFeed(records);
  assert.deepEqual(
    feed.map((e) => e.at),
    ['2026-07-17T11:30:00.000Z', '2026-07-17T10:00:00.000Z', '2026-07-17T09:00:00.000Z']
  );
  // Newest = the agent publish on "Start Here".
  assert.equal(feed[0].actor_phrase, 'Draft Writer (agent) published');
  assert.equal(feed[0].display_name, 'Start Here');
  assert.equal(feed[0].id_tooltip, 'Internal id: page_home');
  // Middle = the human patch on the article.
  assert.equal(feed[1].actor_phrase, 'Wolf Reich edited');
  assert.equal(feed[1].display_name, 'Launch Note');
});

test('feed honours the limit and never emits the raw action as the phrase', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({
    at: `2026-07-17T1${i}:00:00.000Z`.replace('T1', 'T0').slice(0, 24),
    action: 'patch',
    actor: HUMAN,
  }));
  const feed = buildAuditFeed([baseRecord({ history })], { limit: 3 });
  assert.equal(feed.length, 3);
  for (const entry of feed) assert.equal(entry.actor_phrase, 'Wolf Reich edited');
});

test('feed skips malformed history entries and never throws on a corrupt record', () => {
  const records = [
    baseRecord({
      history: [
        { at: '2026-07-17T11:00:00.000Z', action: 'publish', actor: HUMAN },
        // malformed: missing `at`
        { action: 'patch', actor: HUMAN } as never,
        // malformed: missing actor
        { at: '2026-07-17T10:00:00.000Z', action: 'patch' } as never,
        null as never,
      ],
    }),
    // a record whose history isn't an array at all
    { ...baseRecord({ object_id: 'broken' }), history: 'nope' as never },
  ];
  const feed = buildAuditFeed(records);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].action, 'publish');
});

// ═══ attention inbox ══════════════════════════════════════════════════════════

test('inbox surfaces open reviews, unpublished active changes, and held locks with correct stats', () => {
  const records = [
    // published, current → NOT unpublished; counts toward published.
    baseRecord({
      object_id: 'page_pub',
      publication: {
        published_time: '2026-07-15T00:00:00.000Z',
        publish_receipt: {
          kind: 'object_export_commit',
          branch: 'main',
          commit_sha: 'a',
          tree_sha: 'b',
          no_op: false,
          attempts: 1,
          files: [],
          content_revision: 1,
          exported_at: '2026-07-15T00:00:00.000Z',
        },
      },
    }),
    // open review → pending_reviews + in_review; also never-published → unpublished.
    baseRecord({
      object_id: 'page_review',
      body: { title: 'Needs Review' },
      review: { state: 'open', decisions: [] },
    }),
    // held lock.
    baseRecord({ object_id: 'page_locked', body: { title: 'Locked One' }, lock: heldLock() }),
    // archived + unpublished → must NOT appear in unpublished_changes.
    baseRecord({ object_id: 'page_archived', status: 'archived' }),
  ];

  const inbox = buildAttentionInbox(records, { atMs: NOW });

  assert.deepEqual(
    inbox.pending_reviews.map((r) => r.object_id),
    ['page_review']
  );
  assert.equal(inbox.pending_reviews[0].review_state, 'open');

  const unpublishedIds = inbox.unpublished_changes.map((c) => c.object_id).sort();
  assert.deepEqual(unpublishedIds, ['page_locked', 'page_review']);
  assert.ok(!unpublishedIds.includes('page_archived'), 'archived records are excluded from unpublished work');
  assert.ok(!unpublishedIds.includes('page_pub'), 'a current published record is not unpublished');

  assert.deepEqual(
    inbox.held_locks.map((l) => l.object_id),
    ['page_locked']
  );
  assert.equal(inbox.held_locks[0].owner_label, 'editor@example.com');
  assert.ok(!JSON.stringify(inbox.held_locks).includes('secret-token'), 'the lock token must never leak');
  assert.equal(inbox.held_locks[0].age_ms, NOW - Date.parse('2026-07-17T11:50:00.000Z'));

  assert.deepEqual(inbox.stats, { published: 1, in_review: 1, unpublished: 2, locked: 1, total: 4 });
});

test('held locks are ordered oldest-first (most likely stale) and an expired lease is not held', () => {
  const records = [
    baseRecord({ object_id: 'lock_new', lock: heldLock({ acquired_at: '2026-07-17T11:59:00.000Z' }) }),
    baseRecord({ object_id: 'lock_old', lock: heldLock({ acquired_at: '2026-07-17T11:00:00.000Z' }) }),
    // expired lease → not held.
    baseRecord({
      object_id: 'lock_expired',
      lock: heldLock({ acquired_at: '2026-07-17T10:00:00.000Z', expires_at: '2026-07-17T11:00:00.000Z' }),
    }),
  ];
  const inbox = buildAttentionInbox(records, { atMs: NOW });
  assert.deepEqual(
    inbox.held_locks.map((l) => l.object_id),
    ['lock_old', 'lock_new']
  );
});

test('changes_requested counts as a pending review needing attention', () => {
  const inbox = buildAttentionInbox(
    [baseRecord({ object_id: 'page_cr', review: { state: 'changes_requested', decisions: [] } })],
    { atMs: NOW }
  );
  assert.equal(inbox.pending_reviews.length, 1);
  assert.equal(inbox.pending_reviews[0].review_state, 'changes_requested');
  assert.equal(inbox.stats.in_review, 1);
});

test('an approved review is not "pending" but its unpublished body still surfaces as a change', () => {
  const inbox = buildAttentionInbox(
    [baseRecord({ object_id: 'page_ok', review: { state: 'approved', decisions: [] } })],
    { atMs: NOW }
  );
  assert.equal(inbox.pending_reviews.length, 0);
  assert.equal(inbox.stats.in_review, 0);
  assert.deepEqual(
    inbox.unpublished_changes.map((c) => c.object_id),
    ['page_ok']
  );
});
