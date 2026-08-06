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

// ═══ (c) D3-sharedref composed with the gating (integration-branch merge, 59ca018 + D3) ═══
//
// object-verbs-shared-ref-stamp.test.ts proves resolveSharedSectionName works
// when handed a real buildStoreValidationContext(...) result directly. It
// does NOT prove that the *gated* call-site pattern the three HTTP entry
// points (admin-object.ts / object-store.ts / agent/context.ts) actually use
// — `if (verbNeedsValidationContext(action)) { validationContext = await
// buildStoreValidationContext(...) }` — still hands `patch` a context whose
// `records` map is populated by the time stampSharedRefSectionNames runs.
// This reproduces that exact call-site shape (not a shortcut straight to
// buildStoreValidationContext) so a future change to the predicate, or to
// buildStoreValidationContext's parallel sweep, that silently starves
// `patch` of a populated context fails THIS test, not just production.

const gatedValidationContextFor = async (
  store: ObjectVerbStore,
  action: ObjectVerbAction,
  self: Parameters<typeof buildStoreValidationContext>[1]
) => (verbNeedsValidationContext(action) ? await buildStoreValidationContext(store, self) : undefined);

test('patch (upsert_section shared_ref) resolves the target display name through the SAME gated context-build the real HTTP call sites use', async () => {
  const store = createMemoryStore() as unknown as ObjectVerbStore;
  const typedStore = store as unknown as Store;

  const page = {
    object_id: 'page_gate_test',
    object_type: 'page' as const,
    schema_version: 'page.v1',
    site: 'site_drlurie',
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
    status: 'active' as const,
    body: {
      route: '/gate-test',
      pageType: 'standard',
      title: 'Gate test',
      seo: { description: 'x' },
      sections: [{ id: 's_hero', type: 'hero', data: { heading: 'Hi', actions: [] } }],
    },
    publication: { published_time: null },
    history: [],
    version: 1,
    content_revision: 1,
    lock: {
      token: 'lock-gate-test',
      owner_id: 'u1',
      owner_label: 'editor@example.com',
      acquired_at: '2026-07-20T12:00:00.000Z',
      expires_at: '2026-07-20T12:30:00.000Z',
    },
  };
  const target = {
    object_id: 'sec_gate_target',
    object_type: 'section' as const,
    schema_version: 'section.v1',
    site: 'site_drlurie',
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
    status: 'active' as const,
    body: {
      section: { id: 's_gate_target', type: 'prose', data: { body: '<h2>Gated Sweep Target</h2>' } },
    },
    publication: { published_time: null },
    history: [],
    version: 1,
    content_revision: 1,
  };
  typedStore.blobs.set('objects/page/by-id/page_gate_test.json', JSON.stringify(page));
  typedStore.blobs.set('objects/section/by-id/sec_gate_target.json', JSON.stringify(target));

  // verbNeedsValidationContext('patch') must be true, and this call is the
  // production call-site shape, not a direct buildStoreValidationContext call.
  assert.equal(verbNeedsValidationContext('patch'), true);
  const validationContext = await gatedValidationContextFor(store, 'patch', {
    selfObjectId: page.object_id,
    selfObjectType: 'page',
  });
  assert.ok(validationContext, 'patch must receive a built context, not undefined, from the gated call site');

  const res = await handleObjectVerb(
    store,
    {
      action: 'patch',
      object_type: 'page',
      object_id: page.object_id,
      lock_token: 'lock-gate-test',
      expected_record_version: page.version,
      ops: [
        {
          op: 'upsert_section',
          section: { id: 's_sharedgate', type: 'shared_ref', data: { section: target.object_id } },
        },
      ],
    },
    AGENT,
    { nowMs: NOW, validationContext }
  );

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const stored = JSON.parse(typedStore.blobs.get('objects/page/by-id/page_gate_test.json')!);
  const shared = stored.body.sections.find((s: { id: string }) => s.id === 's_sharedgate');
  assert.ok(shared, 'the shared_ref section was written');
  assert.equal(
    shared.data.sectionName,
    'Gated Sweep Target',
    'the gated call-site context (verbNeedsValidationContext + buildStoreValidationContext) must still populate ' +
      "records so resolveSharedSectionName resolves the target's real display name, not degrade to unresolved"
  );
});
