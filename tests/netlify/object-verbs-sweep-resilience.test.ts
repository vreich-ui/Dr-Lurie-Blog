import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { handleObjectVerb, listAllObjectRecords, type ObjectVerbStore } from '../../packages/core/server/lib/object-verbs.js';
import { buildStoreValidationContext } from '../../packages/core/server/lib/object-validation-context.js';
import type { ObjectRecord, Principal } from '../../packages/core/schema/object-record-v1.js';

// 2026-08-06 production hotfix: once record loads inside a bulk sweep
// (inventory's list form, listAllObjectRecords/the audit feed,
// buildStoreValidationContext) run with real concurrency
// (STORE_READ_CONCURRENCY), a single transient `store.get`/`store.list`
// rejection — previously an even-rarer event spread across a slow serial
// loop — reliably aborted the WHOLE sweep instead of just the one bad row,
// because the prior serial code never caught it either; it just almost never
// hit it. Live symptom: /admin/content permanently showing "Couldn't load
// the library — Object request could not be processed." This suite pins
// that a flaky read/list degrades to "skip that one row / that one type",
// never a thrown exception, for every bulk sweep entry point.

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const AGENT: Principal = { kind: 'agent', agent_name: 'sweep-resilience-test', auth: 'publish_key' };

const record = (objectType: string, objectId: string): ObjectRecord =>
  ({
    object_id: objectId,
    object_type: objectType,
    schema_version: 'page.v1',
    site: 'site_test',
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    status: 'active',
    body: {},
    publication: { published_time: null, publish_receipt: null },
    history: [{ at: new Date(NOW).toISOString(), action: 'create', actor: AGENT }],
    version: 1,
    content_revision: 1,
  }) as unknown as ObjectRecord;

/**
 * A store where `get(key)` and `list({prefix})` behave normally EXCEPT for
 * keys/prefixes named in `failGetKeys` / `failListPrefixes`, which reject —
 * simulating exactly the transient Netlify Blobs failure this hotfix guards
 * against.
 */
const createFlakyStore = (
  records: Record<string, ObjectRecord>,
  opts: { failGetKeys?: Set<string>; failListPrefixes?: Set<string> } = {}
): ObjectVerbStore => {
  const blobs = new Map<string, string>(Object.entries(records).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    async get(key: string) {
      if (opts.failGetKeys?.has(key)) throw new Error(`simulated transient read failure for ${key}`);
      return blobs.get(key) ?? null;
    },
    async setJSON() {
      throw new Error('not used in this suite');
    },
    async list({ prefix }: { prefix: string }) {
      if (opts.failListPrefixes?.has(prefix)) throw new Error(`simulated transient list failure for ${prefix}`);
      return { blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  } as unknown as ObjectVerbStore;
};

const PAGE_A = record('page', 'page_a');
const PAGE_B = record('page', 'page_b');
const PAGE_C = record('page', 'page_c');
const RECORDS = {
  'objects/page/by-id/page_a': PAGE_A,
  'objects/page/by-id/page_b': PAGE_B,
  'objects/page/by-id/page_c': PAGE_C,
};

test('listAllObjectRecords: one flaky get() drops only that record, never throws', async () => {
  const store = createFlakyStore(RECORDS, { failGetKeys: new Set(['objects/page/by-id/page_b']) });
  const records = await listAllObjectRecords(store);
  const ids = records.map((r) => r.object_id).sort();
  assert.deepEqual(ids, ['page_a', 'page_c']); // page_b silently skipped, not thrown
});

test('listAllObjectRecords: one flaky list() for a type drops only that type, never throws', async () => {
  const store = createFlakyStore(RECORDS, { failListPrefixes: new Set(['objects/page/by-id/']) });
  const records = await listAllObjectRecords(store);
  assert.deepEqual(records, []); // page type unlistable this sweep, but the call completes
});

test("handleObjectVerb('inventory') list form: one flaky get() returns the surviving rows with 200, not a thrown error", async () => {
  const store = createFlakyStore(RECORDS, { failGetKeys: new Set(['objects/page/by-id/page_a']) });
  const result = await handleObjectVerb(store, { action: 'inventory' }, AGENT, { nowMs: NOW });
  assert.equal(result.status, 200);
  const objects = result.body.objects as Array<{ object_id: string }>;
  const ids = objects.map((o) => o.object_id).sort();
  assert.deepEqual(ids, ['page_b', 'page_c']);
});

test("handleObjectVerb('inventory') list form: one flaky list() for a type still returns 200 with other types intact", async () => {
  const store = createFlakyStore(RECORDS, { failListPrefixes: new Set(['objects/section/by-id/']) });
  const result = await handleObjectVerb(store, { action: 'inventory' }, AGENT, { nowMs: NOW });
  assert.equal(result.status, 200);
  const objects = result.body.objects as Array<{ object_id: string }>;
  assert.deepEqual(
    objects.map((o) => o.object_id).sort(),
    ['page_a', 'page_b', 'page_c']
  );
});

test('buildStoreValidationContext: one flaky get() still resolves, other records remain answerable', async () => {
  const store = createFlakyStore(RECORDS, { failGetKeys: new Set(['objects/page/by-id/page_c']) });
  const context = await buildStoreValidationContext(store);
  assert.ok(context.resolveObject);
  assert.deepEqual(context.resolveObject('page', 'page_a'), { exists: true, published: false });
  assert.deepEqual(context.resolveObject('page', 'page_b'), { exists: true, published: false });
  // page_c's read failed transiently — validation reports it as unresolved
  // (not found), same as the pre-existing corrupt-record behavior, rather
  // than throwing and failing every other object's validation along with it.
  assert.deepEqual(context.resolveObject('page', 'page_c'), { exists: false });
});
