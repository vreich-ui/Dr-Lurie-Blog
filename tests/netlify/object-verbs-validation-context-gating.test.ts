import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleObjectVerb,
  verbNeedsValidationContext,
  type ObjectVerbAction,
  type ObjectVerbRequest,
  type ObjectVerbStore,
} from '../../packages/core/server/lib/object-verbs.js';
import { buildStoreValidationContext } from '../../packages/core/server/lib/object-validation-context.js';
import type { Principal } from '../../packages/core/schema/object-record-v1.js';

// Perf fix (admin/content sweep): admin-object.ts / object-store.ts /
// agent/context.ts now only build a store-backed ObjectValidationContext
// (a full 13-type sweep) for verbs that actually read it. This suite pins:
//
//   1. verbNeedsValidationContext's answer for every action, matched against
//      what each `case` in handleObjectVerb's switch actually does with
//      `context` — the read-only/lock/no-context branches must say `false`,
//      everything that validates a body must say `true`.
//   2. That the write path is NOT weakened: a `create` given a REAL
//      store-backed context still catches a reference-integrity violation
//      exactly as before, and reports it as `optional`/unchecked when no
//      context is supplied (the degraded, pre-T0.8 behavior) — proving the
//      gating in Fix A only removes the context where it was never consulted.

const NOW = Date.parse('2026-07-20T12:00:00.000Z');
const AGENT: Principal = { kind: 'agent', agent_name: 'gating-test', auth: 'publish_key' };

const createMemoryStore = () => {
  const blobs = new Map<string, string>();
  return {
    blobs,
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown) {
      blobs.set(key, JSON.stringify(value));
    },
    async list({ prefix }: { prefix: string }) {
      return { blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
};
type Store = ReturnType<typeof createMemoryStore>;

// ═══ (a) the predicate itself ════════════════════════════════════════════════════════════════════

test('verbNeedsValidationContext: false for pure reads and lock-only verbs', () => {
  const noContextNeeded: ObjectVerbAction[] = [
    'get',
    'list',
    'inventory',
    'checkout',
    'refresh_lock',
    'checkin',
    'submit_review',
    'review_decide',
    'discard',
    'purge_archived',
    'retire',
    'marginalia_create',
    'marginalia_reply',
    'marginalia_list',
    'marginalia_resolve',
  ];
  for (const action of noContextNeeded) {
    assert.equal(verbNeedsValidationContext(action), false, `${action} should not need a validation context`);
  }
});

test('verbNeedsValidationContext: true for every verb that validates or previews a body', () => {
  const contextNeeded: ObjectVerbAction[] = [
    'create',
    'create_variant',
    'instantiate',
    'instantiate_section',
    'apply_theme',
    'patch',
    'validate',
    'publish_by_time',
  ];
  for (const action of contextNeeded) {
    assert.equal(verbNeedsValidationContext(action), true, `${action} should need a validation context`);
  }
});

test('verbNeedsValidationContext: unrecognized future actions fail closed (default true)', () => {
  assert.equal(verbNeedsValidationContext('some_future_verb' as ObjectVerbAction), true);
});

// ═══ (b) the write path keeps its teeth ══════════════════════════════════════════════════

const validPageBody = () => ({
  route: '/',
  pageType: 'home' as const,
  title: 'Dr. Lurié',
  seo: { description: 'Science-first skincare.' },
  navigationOverrides: { footer: 'nav_footer_home' },
  sections: [
    { id: 's_hero', type: 'hero' as const, data: { heading: 'A calmer start', actions: [] } },
    // A shared_ref pointing at a section object that does not exist in the
    // store — the reference-integrity check this is designed to catch.
    { id: 's_ref', type: 'shared_ref' as const, data: { section: 'sec_missing' } },
  ],
});

test('a real store-backed context still 422s a create with a dangling shared_ref (reference integrity)', async () => {
  const store = createMemoryStore() as unknown as ObjectVerbStore;
  const validationContext = await buildStoreValidationContext(store);

  const request: ObjectVerbRequest = {
    action: 'create',
    object_type: 'page',
    site: 'site_drlurie',
    body: validPageBody(),
    requested_id: 'page_dangling_ref',
  };

  const res = await handleObjectVerb(store, request, AGENT, { nowMs: NOW, validationContext });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  const blockers = res.body.blockers as { id: string }[];
  assert.ok(
    blockers.some((b) => b.id === 'references'),
    `expected a 'references' blocker, got ${JSON.stringify(blockers)}`
  );
  // Nothing persisted.
  assert.equal((store as unknown as Store).blobs.get('objects/page/by-id/page_dangling_ref.json'), undefined);
});

test('without ANY validation context (the skip path), the same dangling ref degrades to unverified, not rejected', async () => {
  const store = createMemoryStore() as unknown as ObjectVerbStore;

  const request: ObjectVerbRequest = {
    action: 'create',
    object_type: 'page',
    site: 'site_drlurie',
    body: validPageBody(),
    requested_id: 'page_dangling_ref_2',
  };

  // No validationContext at all — exactly what admin-object.ts / object-store.ts
  // now pass for a verb that doesn't need one (validationContext: undefined).
  // create DOES need one (verbNeedsValidationContext('create') === true), so
  // this scenario never happens in production for `create` — this pins the
  // pre-existing (T0.7) degrade behavior that makes the contrast with the test
  // above meaningful: the 422 above comes from the context being present and
  // real, not from some other rule.
  const res = await handleObjectVerb(store, request, AGENT, { nowMs: NOW });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('an inventory request never needs (and, per the predicate, never gets) a validation context', async () => {
  const store = createMemoryStore() as unknown as ObjectVerbStore;
  // Seed one page directly so inventory has something to report.
  (store as unknown as Store).blobs.set(
    'objects/page/by-id/page_seed.json',
    JSON.stringify({
      object_id: 'page_seed',
      object_type: 'page',
      schema_version: 'page.v1',
      site: 'site_drlurie',
      created_at: '2026-07-20T00:00:00.000Z',
      updated_at: '2026-07-20T00:00:00.000Z',
      status: 'active',
      body: { route: '/', pageType: 'home', title: 'Seed' },
      publication: { published_time: null },
      history: [],
      version: 1,
      content_revision: 1,
    })
  );

  assert.equal(verbNeedsValidationContext('inventory'), false);
  // Calling with validationContext: undefined — exactly what the gated caller
  // now passes — must still succeed and return the seeded row.
  const res = await handleObjectVerb(
    store,
    { action: 'inventory' },
    AGENT,
    { nowMs: NOW, validationContext: undefined }
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const objects = res.body.objects as { object_id: string }[];
  assert.ok(objects.some((o) => o.object_id === 'page_seed'));
});
