import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { handleObjectVerb, type ObjectVerbRequest, type ObjectVerbStore } from '../../packages/core/server/lib/object-verbs.js';
import { buildStoreValidationContext } from '../../packages/core/server/lib/object-validation-context.js';
import { objectRecordKey } from '../../packages/core/server/lib/object-store-keys.js';
import type { PageBody } from '../../packages/core/schema/bodies/page-v1.js';
import type { ObjectRecord, Principal } from '../../packages/core/schema/object-record-v1.js';

// The `instantiate` verb (W2.5): template recipe → new page THROUGH the
// existing create path, so route uniqueness / PageType law / reference
// integrity gate an instantiated page exactly like a hand-authored one.
// Slot-fill semantics are pinned in template-instantiate.test.ts; this suite
// covers the verb wiring, the store-backed rules, and dry_run.

const NOW = Date.parse('2026-07-11T12:00:00.000Z');
const AGENT: Principal = { kind: 'agent', agent_name: 'instantiate-test', auth: 'publish_key' };

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

// Mirrors object-store.ts: a fresh store-backed validation context per call, so
// the live rules (route uniqueness, PageType law, references) actually bite.
const call = async (store: Store, request: ObjectVerbRequest, principal: Principal = AGENT) => {
  const verbStore = store as unknown as ObjectVerbStore;
  const validationContext = await buildStoreValidationContext(verbStore);
  return handleObjectVerb(verbStore, request, principal, { nowMs: NOW, validationContext });
};

const templateBody = () => ({
  name: 'Interior page',
  appliesTo: ['standard'],
  slots: [
    {
      slotId: 'slot_lede',
      allowed: ['lede'],
      required: true,
      repeatable: false,
      blueprint: { id: 's_bplede', type: 'lede', data: { heading: 'Starter heading', actions: [] } },
    },
    { slotId: 'slot_body', allowed: ['prose'], required: false, repeatable: true },
  ],
});

const seedTemplate = async (store: Store, body: Record<string, unknown> = templateBody(), id = 'tpl_interior') => {
  const res = await call(store, {
    action: 'create',
    object_type: 'template',
    site: 'site_drlurie',
    body,
    requested_id: id,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return id;
};

const instantiate = (overrides: Partial<Extract<ObjectVerbRequest, { action: 'instantiate' }>> = {}) =>
  ({
    action: 'instantiate',
    template_id: 'tpl_interior',
    site: 'site_drlurie',
    route: '/probe',
    title: 'Probe page',
    ...overrides,
  }) as ObjectVerbRequest;

test('instantiate creates a page through the create path: blueprint copied, provenance stamped, record persisted', async () => {
  const store = createMemoryStore();
  await seedTemplate(store);

  const res = await call(store, instantiate({ requested_id: 'page_probe' }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.instantiated_from, 'tpl_interior');

  const record = res.body.record as ObjectRecord;
  assert.equal(record.object_id, 'page_probe');
  assert.equal(record.object_type, 'page');
  assert.equal(record.version, 1);
  assert.equal(record.history[0]!.action, 'create');

  const body = record.body as PageBody;
  assert.equal(body.route, '/probe');
  assert.equal(body.pageType, 'standard'); // appliesTo[0]
  assert.deepEqual(body.template, { ref: 'tpl_interior', instantiated_at: new Date(NOW).toISOString() });
  assert.equal(body.sections.length, 1); // required blueprint copied; optional empty slot skipped
  assert.equal(body.sections[0]!.type, 'lede');
  assert.notEqual(body.sections[0]!.id, 's_bplede'); // a copy, not a reference

  // Persisted for real (round-trips through get).
  const fetched = await call(store, { action: 'get', object_type: 'page', object_id: 'page_probe' });
  assert.equal(fetched.status, 200);
});

test('instantiate 404s for a missing template', async () => {
  const store = createMemoryStore();
  const res = await call(store, instantiate({ template_id: 'tpl_missing' }));
  assert.equal(res.status, 404);
  assert.equal(res.body.not_found, true);
  assert.equal(res.body.template_id, 'tpl_missing');
});

test('a builder error surfaces as 422 (empty appliesTo, no explicit page_type)', async () => {
  // (The builder's other error paths — shared_ref-only required slots etc. —
  // cannot reach the verb: template validation refuses to store such recipes.
  // They are pinned in template-instantiate.test.ts.)
  const store = createMemoryStore();
  await seedTemplate(store, {
    name: 'Unanchored recipe',
    appliesTo: [],
    slots: [
      {
        slotId: 'slot_body',
        allowed: ['prose'],
        required: true,
        repeatable: false,
        blueprint: { id: 's_bpbody', type: 'prose', data: { body: '<p>Copy.</p>' } },
      },
    ],
  });
  const res = await call(store, instantiate());
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.match(String(res.body.error), /pass page_type explicitly/);

  // With an explicit page_type the same template instantiates fine.
  const explicit = await call(store, instantiate({ page_type: 'standard' }));
  assert.equal(explicit.status, 200, JSON.stringify(explicit.body));
});

test('route uniqueness gates an instantiated page like any create', async () => {
  const store = createMemoryStore();
  await seedTemplate(store);
  const first = await call(store, instantiate({ requested_id: 'page_probe' }));
  assert.equal(first.status, 200);

  const clash = await call(store, instantiate({ requested_id: 'page_probe_two' }));
  assert.equal(clash.status, 422, JSON.stringify(clash.body));
  assert.ok(
    JSON.stringify(clash.body.validation).includes('structure_route'),
    'route conflict must be the reported blocker'
  );
});

test('PageType law beats the recipe: a blueprint type the PageType forbids blocks the create', async () => {
  const store = createMemoryStore();
  // Valid template (bio ∈ slot.allowed, bio is registered) whose product is
  // illegal for pageType system (allowed: hero/prose/link_list/cta_banner).
  await seedTemplate(store, {
    name: 'Recipe vs law',
    appliesTo: ['system'],
    slots: [
      {
        slotId: 'slot_bio',
        allowed: ['bio'],
        required: true,
        repeatable: false,
        blueprint: { id: 's_bpbio', type: 'bio', data: { heading: 'Bio', body: '<p>Bio.</p>', trustNotes: [] } },
      },
    ],
  });
  const res = await call(store, instantiate());
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.ok(JSON.stringify(res.body.validation).includes('structure_allowed'), 'the PageType law is the blocker');
});

test('explicit page_type outside a non-empty appliesTo is rejected', async () => {
  const store = createMemoryStore();
  await seedTemplate(store);
  const res = await call(store, instantiate({ page_type: 'system' }));
  assert.equal(res.status, 422);
  assert.match(String(res.body.error), /does not apply to pageType "system"/);
});

test('dry_run previews body, would-be id, availability, and validation — and persists nothing', async () => {
  const store = createMemoryStore();
  await seedTemplate(store);
  const before = store.blobs.size;

  const res = await call(store, instantiate({ dry_run: true }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.dry_run, true);
  assert.equal(res.body.instantiated_from, 'tpl_interior');
  assert.equal(res.body.id_available, true);
  assert.equal(typeof res.body.object_id, 'string');
  const body = res.body.body as PageBody;
  assert.equal(body.sections.length, 1);
  assert.equal((res.body.summary as { eligible: boolean }).eligible, true);

  assert.equal(store.blobs.size, before, 'dry_run must not write anything');
  assert.equal(store.blobs.get(objectRecordKey('page', res.body.object_id as string)), undefined);
});

test('dry_run reports id_available: false for a taken requested_id', async () => {
  const store = createMemoryStore();
  await seedTemplate(store);
  const created = await call(store, instantiate({ requested_id: 'page_probe' }));
  assert.equal(created.status, 200);

  const res = await call(store, instantiate({ requested_id: 'page_probe', route: '/probe-two', dry_run: true }));
  assert.equal(res.status, 200);
  assert.equal(res.body.id_available, false);
});

test('an invalid requested_id is a 400, dry_run or not', async () => {
  const store = createMemoryStore();
  await seedTemplate(store);
  for (const dryRun of [true, false]) {
    const res = await call(store, instantiate({ requested_id: 'sec_wrong_prefix', dry_run: dryRun }));
    assert.equal(res.status, 400, JSON.stringify(res.body));
  }
});
