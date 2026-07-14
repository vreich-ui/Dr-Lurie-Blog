/**
 * W8.2 — the `instantiate_section` verb (09-template-system-plan §3) and the
 * templateSlot `blueprintRef` composition (§4).
 *
 * Page mode composes ONE upsert_section through the standard patch path under
 * the CALLER'S checkout (never auto-checkouts); standalone mode mints a new
 * shared sec_* object through the create path. Both are gated by the full
 * validation pipeline — "law beats recipe" is pinned below. blueprintRef is
 * dereferenced + deep-copied at instantiation only, and validated live
 * (existence + type-in-allowed) through the store-backed context.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { handleObjectVerb, type ObjectVerbRequest, type ObjectVerbStore } from '../../netlify/lib/object-verbs.js';
import { buildStoreValidationContext } from '../../netlify/lib/object-validation-context.js';
import { objectRecordKey } from '../../netlify/lib/object-store-keys.js';
import { derivePatchInverse, type PatchOpCapture } from '../../src/lib/object-patch-apply.js';
import type { PatchOp } from '../../src/schema/object-patch-ops.js';
import type { PageBody } from '../../src/schema/bodies/page-v1.js';
import type { ObjectRecord, Principal } from '../../src/schema/object-record-v1.js';

const NOW = Date.parse('2026-07-14T12:00:00.000Z');
const AGENT: Principal = { kind: 'agent', agent_name: 'stamp-test', auth: 'publish_key' };

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

// Mirrors object-store.ts / admin-object.ts: the self ref comes from
// object_id, or — for instantiate_section page mode (W8.2) — the target page.
const call = async (store: Store, request: ObjectVerbRequest, principal: Principal = AGENT) => {
  const verbStore = store as unknown as ObjectVerbStore;
  const requestData = request as { object_id?: string; object_type?: string; target?: { kind?: string; page_id?: string } };
  const targetPageId = requestData.target?.kind === 'page' ? requestData.target.page_id : undefined;
  const validationContext = await buildStoreValidationContext(verbStore, {
    selfObjectId: requestData.object_id ?? targetPageId,
    selfObjectType: (requestData.object_type ?? (targetPageId ? 'page' : undefined)) as never,
  });
  return handleObjectVerb(verbStore, request, principal, { nowMs: NOW, validationContext });
};

const heroRecipeBody = () => ({
  name: 'Landing hero',
  blueprint: {
    id: 's_stplhero',
    type: 'hero',
    data: { kicker: 'Overview', heading: 'New hero heading', actions: [] },
  },
});

const ctaRecipeBody = () => ({
  name: 'Closing CTA',
  blueprint: { id: 's_stplcta', type: 'cta_banner', data: { heading: 'Keep exploring', actions: [] } },
});

const standardPageBody = (route = '/probe'): Record<string, unknown> => ({
  route,
  pageType: 'standard',
  title: 'Probe page',
  seo: { description: 'Probe.' },
  sections: [{ id: 's_lede', type: 'lede', data: { heading: 'Opening', actions: [] } }],
});

const seedObject = async (
  store: Store,
  objectType: 'section_template' | 'page' | 'template',
  id: string,
  body: Record<string, unknown>
) => {
  const res = await call(store, { action: 'create', object_type: objectType, site: 'site_drlurie', body, requested_id: id });
  assert.equal(res.status, 200, `${id}: ${JSON.stringify(res.body)}`);
  return res.body.record as ObjectRecord;
};

const checkoutPage = async (store: Store, pageId: string) => {
  const res = await call(store, { action: 'checkout', object_type: 'page', object_id: pageId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { lockToken: res.body.lockToken as string, recordVersion: res.body.record_version as number };
};

const loadPage = (store: Store, pageId: string): ObjectRecord =>
  JSON.parse(store.blobs.get(objectRecordKey('page', pageId))!) as ObjectRecord;

// ═══ page mode ════════════════════════════════════════════════════════════════

test('page mode stamps a deep copy under the caller lock: fresh id, position honored, provenance in history', async () => {
  const store = createMemoryStore();
  await seedObject(store, 'section_template', 'stpl_hero_landing', heroRecipeBody());
  await seedObject(store, 'page', 'page_probe', standardPageBody());
  const { lockToken, recordVersion } = await checkoutPage(store, 'page_probe');

  const res = await call(store, {
    action: 'instantiate_section',
    section_template_id: 'stpl_hero_landing',
    target: { kind: 'page', page_id: 'page_probe', position: 0, lock_token: lockToken, expected_record_version: recordVersion },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.instantiated_from, 'stpl_hero_landing');

  const page = loadPage(store, 'page_probe');
  const sections = (page.body as PageBody).sections;
  assert.equal(sections.length, 2);
  assert.equal(sections[0]!.type, 'hero', 'position 0 honored');
  assert.equal(sections[0]!.id, res.body.section_id);
  assert.notEqual(sections[0]!.id, 's_stplhero', 'the blueprint id is a placeholder — a fresh id is minted');
  assert.deepEqual(sections[0]!.data, heroRecipeBody().blueprint.data, 'data deep-copied verbatim');

  const entry = page.history.at(-1)!;
  assert.equal(entry.action, 'upsert_section');
  assert.equal(entry.details?.instantiated_from, 'stpl_hero_landing', 'history carries the recipe provenance');

  // The inverse comes free from the capture: Discard removes the stamp.
  const inverse = derivePatchInverse(entry.details!.op as PatchOp, entry.details!.capture as PatchOpCapture);
  assert.equal(inverse.op, 'remove_section');
  const undo = await call(store, {
    action: 'patch',
    object_type: 'page',
    object_id: 'page_probe',
    lock_token: lockToken,
    expected_record_version: page.version,
    ops: [inverse],
  });
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.equal((loadPage(store, 'page_probe').body as PageBody).sections.length, 1, 'the stamp is fully undoable');
});

test('a second stamp after the version moved inserts ANOTHER copy with a distinct id (retries stay idempotent per version)', async () => {
  const store = createMemoryStore();
  await seedObject(store, 'section_template', 'stpl_cta', ctaRecipeBody());
  await seedObject(store, 'page', 'page_probe', standardPageBody());
  const first = await checkoutPage(store, 'page_probe');

  const stamp = (lockToken: string, expected: number) =>
    call(store, {
      action: 'instantiate_section',
      section_template_id: 'stpl_cta',
      target: { kind: 'page', page_id: 'page_probe', lock_token: lockToken, expected_record_version: expected },
    });

  const one = await stamp(first.lockToken, first.recordVersion);
  assert.equal(one.status, 200, JSON.stringify(one.body));
  const two = await stamp(first.lockToken, one.body.version as number);
  assert.equal(two.status, 200, JSON.stringify(two.body));
  assert.notEqual(one.body.section_id, two.body.section_id);
  assert.equal((loadPage(store, 'page_probe').body as PageBody).sections.length, 3);
});

test('page mode REQUIRES the caller lock (423) and a current version (409) — the verb never auto-checkouts', async () => {
  const store = createMemoryStore();
  await seedObject(store, 'section_template', 'stpl_cta', ctaRecipeBody());
  await seedObject(store, 'page', 'page_probe', standardPageBody());

  const noLock = await call(store, {
    action: 'instantiate_section',
    section_template_id: 'stpl_cta',
    target: { kind: 'page', page_id: 'page_probe', lock_token: 'nope', expected_record_version: 1 },
  });
  assert.equal(noLock.status, 423);

  const { lockToken } = await checkoutPage(store, 'page_probe');
  const stale = await call(store, {
    action: 'instantiate_section',
    section_template_id: 'stpl_cta',
    target: { kind: 'page', page_id: 'page_probe', lock_token: lockToken, expected_record_version: 0 },
  });
  assert.equal(stale.status, 409);
});

test('LAW BEATS RECIPE: stamping a type the PageType disallows is a 422 and persists nothing', async () => {
  const store = createMemoryStore();
  await seedObject(store, 'section_template', 'stpl_hero_landing', heroRecipeBody());
  // `listing` allows lede/prose/cta_banner/newsletter_signup/content_grid/
  // link_list/shared_ref — hero is NOT in the set.
  await seedObject(store, 'page', 'page_listing', {
    route: '/probe-listing',
    pageType: 'listing',
    title: 'Listing probe',
    seo: { description: 'Probe.' },
    sections: [{ id: 's_lede', type: 'lede', data: { heading: 'Library', actions: [] } }],
  });
  const { lockToken, recordVersion } = await checkoutPage(store, 'page_listing');

  const res = await call(store, {
    action: 'instantiate_section',
    section_template_id: 'stpl_hero_landing',
    target: { kind: 'page', page_id: 'page_listing', lock_token: lockToken, expected_record_version: recordVersion },
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.equal((loadPage(store, 'page_listing').body as PageBody).sections.length, 1, 'nothing persisted');
});

test('page-mode dry_run previews the exact op + validation with NO lock and NO persistence', async () => {
  const store = createMemoryStore();
  await seedObject(store, 'section_template', 'stpl_cta', ctaRecipeBody());
  await seedObject(store, 'page', 'page_probe', standardPageBody());

  const res = await call(store, {
    action: 'instantiate_section',
    section_template_id: 'stpl_cta',
    target: { kind: 'page', page_id: 'page_probe', position: 1, lock_token: 'unused', expected_record_version: 1 },
    dry_run: true,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.dry_run, true);
  assert.equal(res.body.eligible, true);
  const op = res.body.op as { op: string; section: { type: string }; position: number };
  assert.equal(op.op, 'upsert_section');
  assert.equal(op.section.type, 'cta_banner');
  assert.equal(op.position, 1);
  assert.equal((loadPage(store, 'page_probe').body as PageBody).sections.length, 1, 'nothing persisted');
});

// ═══ standalone mode ══════════════════════════════════════════════════════════

test('standalone mode mints a shared sec_* object through the create path (site from the recipe record)', async () => {
  const store = createMemoryStore();
  await seedObject(store, 'section_template', 'stpl_hero_landing', heroRecipeBody());

  const res = await call(store, {
    action: 'instantiate_section',
    section_template_id: 'stpl_hero_landing',
    target: { kind: 'standalone' },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const record = res.body.record as ObjectRecord;
  assert.equal(record.object_type, 'section');
  assert.equal(record.object_id, 'sec_hero_landing', 'id minted from the recipe name');
  assert.equal(record.site, 'site_drlurie');
  const wrapped = (record.body as { section: { id: string; type: string; data: unknown } }).section;
  assert.equal(wrapped.type, 'hero');
  assert.notEqual(wrapped.id, 's_stplhero', 'fresh instance id');
  assert.deepEqual(wrapped.data, heroRecipeBody().blueprint.data);
});

test('standalone dry_run reports the would-be id + availability and persists nothing', async () => {
  const store = createMemoryStore();
  await seedObject(store, 'section_template', 'stpl_cta', ctaRecipeBody());

  const res = await call(store, {
    action: 'instantiate_section',
    section_template_id: 'stpl_cta',
    target: { kind: 'standalone', requested_id: 'sec_probe_cta' },
    dry_run: true,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.object_id, 'sec_probe_cta');
  assert.equal(res.body.id_available, true);
  assert.equal(store.blobs.has(objectRecordKey('section', 'sec_probe_cta')), false);
});

test('a missing recipe is a 404; instantiate_section names it', async () => {
  const store = createMemoryStore();
  const res = await call(store, {
    action: 'instantiate_section',
    section_template_id: 'stpl_ghost',
    target: { kind: 'standalone' },
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.section_template_id, 'stpl_ghost');
});

// ═══ blueprintRef composition (§4) ════════════════════════════════════════════

const refTemplateBody = () => ({
  name: 'Composed landing',
  appliesTo: ['standard'],
  slots: [
    { slotId: 'slot_hero', allowed: ['hero'], required: true, repeatable: false, blueprintRef: 'stpl_hero_landing' },
    { slotId: 'slot_cta', allowed: ['cta_banner'], required: false, repeatable: false },
  ],
});

test('a template slot blueprintRef is dereferenced + deep-copied at instantiation', async () => {
  const store = createMemoryStore();
  await seedObject(store, 'section_template', 'stpl_hero_landing', heroRecipeBody());
  await seedObject(store, 'template', 'tpl_composed', refTemplateBody());

  const res = await call(store, {
    action: 'instantiate',
    template_id: 'tpl_composed',
    site: 'site_drlurie',
    route: '/composed',
    title: 'Composed page',
    requested_id: 'page_composed',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const page = (res.body.record as ObjectRecord).body as PageBody;
  assert.equal(page.sections.length, 1, 'required ref slot filled; optional empty slot skipped');
  assert.equal(page.sections[0]!.type, 'hero');
  assert.deepEqual(page.sections[0]!.data, heroRecipeBody().blueprint.data, 'the referenced blueprint was copied');
  assert.notEqual(page.sections[0]!.id, 's_stplhero');
});

test('CREATE-time law: a template with a dangling or type-mismatched blueprintRef is rejected (422)', async () => {
  const store = createMemoryStore();
  await seedObject(store, 'section_template', 'stpl_cta', ctaRecipeBody());

  const dangling = await call(store, {
    action: 'create',
    object_type: 'template',
    site: 'site_drlurie',
    body: refTemplateBody(), // stpl_hero_landing does not exist in this store
    requested_id: 'tpl_dangling',
  });
  assert.equal(dangling.status, 422, JSON.stringify(dangling.body));

  const mismatched = await call(store, {
    action: 'create',
    object_type: 'template',
    site: 'site_drlurie',
    body: {
      name: 'Mismatch',
      appliesTo: ['standard'],
      // The slot allows hero but the referenced recipe blueprints a cta_banner.
      slots: [{ slotId: 'slot_hero', allowed: ['hero'], required: true, repeatable: false, blueprintRef: 'stpl_cta' }],
    },
    requested_id: 'tpl_mismatch',
  });
  assert.equal(mismatched.status, 422, JSON.stringify(mismatched.body));
});

test('INSTANTIATE-time law: a ref that vanished after template creation fails the instantiate with 422', async () => {
  const store = createMemoryStore();
  await seedObject(store, 'section_template', 'stpl_hero_landing', heroRecipeBody());
  await seedObject(store, 'template', 'tpl_composed', refTemplateBody());
  store.blobs.delete(objectRecordKey('section_template', 'stpl_hero_landing'));

  const res = await call(store, {
    action: 'instantiate',
    template_id: 'tpl_composed',
    site: 'site_drlurie',
    route: '/composed',
    title: 'Composed page',
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
  assert.match(String(res.body.error), /does not resolve/);
});

test('schema law: blueprint and blueprintRef are mutually exclusive on one slot', async () => {
  const store = createMemoryStore();
  await seedObject(store, 'section_template', 'stpl_cta', ctaRecipeBody());
  const res = await call(store, {
    action: 'create',
    object_type: 'template',
    site: 'site_drlurie',
    body: {
      name: 'Both',
      appliesTo: ['standard'],
      slots: [
        {
          slotId: 'slot_cta',
          allowed: ['cta_banner'],
          required: true,
          repeatable: false,
          blueprint: ctaRecipeBody().blueprint,
          blueprintRef: 'stpl_cta',
        },
      ],
    },
    requested_id: 'tpl_both',
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));
});
