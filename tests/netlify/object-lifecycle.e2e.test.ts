import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { handler } from '../../netlify/functions/mcp.js';
import { setLocalBlobsRootForTesting } from '../../netlify/lib/local-blobs.js';
import { derivePatchInverse, type PatchOpCapture } from '../../packages/core/lib/object-patch-apply.js';
import type { PatchOp } from '../../packages/core/schema/object-patch-ops.js';
import type { HistoryEntry, ObjectRecord } from '../../packages/core/schema/object-record-v1.js';

/**
 * T0.11 — Phase 0 exit drill.
 *
 * Proves the whole Phase 0 object store works as a SYSTEM — not just as
 * isolated units — by driving the generic verb surface exclusively through
 * the MCP tool endpoint (`netlify/functions/mcp.js`), the same entry point an
 * agent principal actually uses. That also stands in as the "verbs are
 * reachable via MCP" exit criterion; every other test file exercises
 * `handleObjectVerb`/`object-store.ts` directly instead.
 *
 * Matches 04-phased-plan.md's P0 exit criteria verbatim:
 *   "create → checkout → patch (with inverse replay) → validate → get
 *    round-trips for a test page and navigation object; 423/409 conflict
 *    behavior matches the audited lock/version semantics; MCP object_* tools
 *    callable with the existing publish key."
 */

for (const key of [
  'NETLIFY',
  'NETLIFY_SITE_ID',
  'NETLIFY_BLOBS_TOKEN',
  'NETLIFY_AUTH_TOKEN',
  'SITE_ID',
  'MCP_HTTP_AUTH_TOKEN',
]) {
  delete process.env[key];
}
process.env.PUBLISH_SECRET = 'test-publish-secret';

// Isolated from the default .netlify/local-blobs root: this suite and its siblings
// (object-store-auth.test.ts, mcp-object-tools.test.ts) all exercise the site-objects
// local fallback store, and node:test runs separate test files concurrently, so sharing
// one on-disk directory raced resets against reads/writes across files.
const LOCAL_BLOBS_ROOT = join(process.cwd(), '.netlify', 'local-blobs-test', 'object-lifecycle-e2e');
setLocalBlobsRootForTesting(LOCAL_BLOBS_ROOT);
const SITE_OBJECTS_DIR = join(LOCAL_BLOBS_ROOT, 'site-objects');
const reset = () => rm(SITE_OBJECTS_DIR, { recursive: true, force: true });

type ToolDefinition = { name: string };
type ToolCallResult = { isError?: boolean; structuredContent?: Record<string, unknown> };

const rpc = async (method: string, params?: Record<string, unknown>) => {
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  });
  assert.equal(response.statusCode, 200);
  return JSON.parse(response.body) as { result: Record<string, unknown> };
};

const listTools = async (): Promise<ToolDefinition[]> => {
  const body = await rpc('tools/list');
  return (body.result as { tools: ToolDefinition[] }).tools;
};

const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
  const body = await rpc('tools/call', { name, arguments: args });
  return body.result as ToolCallResult;
};

// ═══ fixtures ══════════════════════════════════════════════════════════════

const pageBody = () => ({
  route: '/e2e-lifecycle-drill',
  pageType: 'standard',
  title: 'E2E Lifecycle Drill',
  seo: { description: 'Phase 0 exit-drill fixture; never rendered on the public site.' },
  sections: [{ id: 's_drillhero', type: 'hero', data: { heading: 'Original heading', actions: [] } }],
});

const navigationBody = () => ({
  role: 'footer',
  groups: [
    {
      id: 'grp_drill',
      items: [{ id: 'item_drill', label: 'Original label', target: { kind: 'route', href: '/' } }],
    },
  ],
});

// ═══ MCP reachability ═════════════════════════════════════════════════════

test('every object verb this drill exercises is reachable via MCP tools/list', async () => {
  const tools = await listTools();
  const names = new Set(tools.map((tool) => tool.name));
  for (const name of [
    'object_get',
    'object_create',
    'object_checkout',
    'object_patch',
    'object_validate',
    'object_checkin',
  ]) {
    assert.ok(names.has(name), `expected tools/list to include ${name}`);
  }
});

// ═══ round-trip drill: create → checkout → patch → replay inverse → validate → get ═

type RoundTripFixture = {
  objectType: 'page' | 'navigation';
  objectId: string;
  body: Record<string, unknown>;
  forwardOp: Record<string, unknown>;
  assertForwardApplied: (body: unknown) => void;
};

const runRoundTripDrill = async (fixture: RoundTripFixture) => {
  await reset();

  // create
  const created = await callTool('object_create', {
    object_type: fixture.objectType,
    site: 'site_drlurie',
    body: fixture.body,
    requested_id: fixture.objectId,
  });
  assert.ok(!created.isError, JSON.stringify(created.structuredContent));
  const createdRecord = created.structuredContent?.record as ObjectRecord;
  assert.equal(createdRecord.object_id, fixture.objectId);
  assert.equal(createdRecord.version, 1);
  const preSnapshotBody = createdRecord.body;

  // checkout
  const checkout = await callTool('object_checkout', {
    object_type: fixture.objectType,
    object_id: fixture.objectId,
  });
  assert.ok(!checkout.isError, JSON.stringify(checkout.structuredContent));
  const lockToken = checkout.structuredContent?.lockToken as string;
  const versionAfterCheckout = checkout.structuredContent?.record_version as number;
  assert.ok(lockToken, 'checkout must return a lock_token');

  // patch (forward)
  const patch = await callTool('object_patch', {
    object_type: fixture.objectType,
    object_id: fixture.objectId,
    lock_token: lockToken,
    expected_record_version: versionAfterCheckout,
    ops: [fixture.forwardOp],
  });
  assert.ok(!patch.isError, JSON.stringify(patch.structuredContent));
  const versionAfterPatch = patch.structuredContent?.version as number;

  // Read back the applied op + its capture (stored on the history entry) so
  // the inverse can be derived from exactly what was recorded — the same
  // mechanism the human-review Discard action uses (C§2.4).
  const afterPatchGet = await callTool('object_get', {
    object_type: fixture.objectType,
    object_id: fixture.objectId,
  });
  assert.ok(!afterPatchGet.isError);
  const afterPatchRecord = afterPatchGet.structuredContent?.record as ObjectRecord;
  fixture.assertForwardApplied(afterPatchRecord.body);
  const lastEntry = afterPatchRecord.history[afterPatchRecord.history.length - 1] as HistoryEntry & {
    details: { op: PatchOp; capture: PatchOpCapture };
  };
  const inverseOp = derivePatchInverse(lastEntry.details.op, lastEntry.details.capture);

  // replay the inverse (still under the same held lock)
  const inversePatch = await callTool('object_patch', {
    object_type: fixture.objectType,
    object_id: fixture.objectId,
    lock_token: lockToken,
    expected_record_version: versionAfterPatch,
    ops: [inverseOp],
  });
  assert.ok(!inversePatch.isError, JSON.stringify(inversePatch.structuredContent));

  // validate (dry-run readiness report on the reverted draft)
  const validate = await callTool('object_validate', {
    object_type: fixture.objectType,
    object_id: fixture.objectId,
  });
  assert.ok(!validate.isError, JSON.stringify(validate.structuredContent));
  assert.ok(Array.isArray(validate.structuredContent?.validation));

  // get: confirm the object is back to its exact pre-patch state
  const finalGet = await callTool('object_get', { object_type: fixture.objectType, object_id: fixture.objectId });
  assert.ok(!finalGet.isError);
  const finalRecord = finalGet.structuredContent?.record as ObjectRecord;
  assert.deepEqual(finalRecord.body, preSnapshotBody, 'inverse replay must restore the exact pre-patch body');

  // release the lease
  const checkin = await callTool('object_checkin', {
    object_type: fixture.objectType,
    object_id: fixture.objectId,
    lock_token: lockToken,
  });
  assert.ok(!checkin.isError);

  return finalRecord;
};

test('page fixture: create → checkout → patch → replay inverse → validate → get round-trips exactly', async () => {
  await runRoundTripDrill({
    objectType: 'page',
    objectId: 'page_e2e_drill',
    body: pageBody(),
    forwardOp: {
      op: 'update_section_data',
      section_id: 's_drillhero',
      fields: { heading: 'Patched heading for the drill' },
    },
    assertForwardApplied: (body) => {
      const sections = (body as ReturnType<typeof pageBody>).sections;
      assert.equal(sections[0].data.heading, 'Patched heading for the drill');
    },
  });
});

test('navigation fixture: create → checkout → patch → replay inverse → validate → get round-trips exactly', async () => {
  await runRoundTripDrill({
    objectType: 'navigation',
    objectId: 'nav_e2e_drill',
    body: navigationBody(),
    forwardOp: {
      op: 'update_item',
      group_id: 'grp_drill',
      item_id: 'item_drill',
      fields: { label: 'Patched label for the drill' },
    },
    assertForwardApplied: (body) => {
      const groups = (body as ReturnType<typeof navigationBody>).groups;
      assert.equal(groups[0].items[0].label, 'Patched label for the drill');
    },
  });
});

// ═══ conflict-semantics parity (423 vs 409), provoked through MCP ═════════

const conflictOp = (objectType: 'page' | 'navigation') =>
  objectType === 'page'
    ? { op: 'update_section_data', section_id: 's_drillhero', fields: { heading: 'x' } }
    : { op: 'update_item', group_id: 'grp_drill', item_id: 'item_drill', fields: { label: 'x' } };

const runConflictDrill = async (objectType: 'page' | 'navigation', objectId: string, body: Record<string, unknown>) => {
  await reset();
  const created = await callTool('object_create', {
    object_type: objectType,
    site: 'site_drlurie',
    body,
    requested_id: objectId,
  });
  assert.ok(!created.isError, JSON.stringify(created.structuredContent));

  // No lock held at all → 423.
  const noLock = await callTool('object_patch', {
    object_type: objectType,
    object_id: objectId,
    lock_token: 'not-held',
    expected_record_version: 1,
    ops: [conflictOp(objectType)],
  });
  assert.equal(noLock.isError, true);
  assert.equal(noLock.structuredContent?.statusCode, 423);

  const checkout = await callTool('object_checkout', { object_type: objectType, object_id: objectId });
  const lockToken = checkout.structuredContent?.lockToken as string;
  const version = checkout.structuredContent?.record_version as number;

  // Held lock, wrong token → 423 (distinct code path from "no lock").
  const wrongToken = await callTool('object_patch', {
    object_type: objectType,
    object_id: objectId,
    lock_token: 'wrong-token',
    expected_record_version: version,
    ops: [conflictOp(objectType)],
  });
  assert.equal(wrongToken.isError, true);
  assert.equal(wrongToken.structuredContent?.statusCode, 423);

  // Correct token, stale expected_record_version → 409 (distinct from 423).
  const staleVersion = await callTool('object_patch', {
    object_type: objectType,
    object_id: objectId,
    lock_token: lockToken,
    expected_record_version: version - 1,
    ops: [conflictOp(objectType)],
  });
  assert.equal(staleVersion.isError, true);
  assert.equal(staleVersion.structuredContent?.statusCode, 409);

  // release the lease so the fixture doesn't leak a held lock.
  const checkin = await callTool('object_checkin', {
    object_type: objectType,
    object_id: objectId,
    lock_token: lockToken,
  });
  assert.ok(!checkin.isError);
};

test('conflict semantics parity (page): 423 with no lock, 423 on wrong token, 409 on stale version', async () => {
  await runConflictDrill('page', 'page_e2e_conflict', pageBody());
});

test('conflict semantics parity (navigation): 423 with no lock, 423 on wrong token, 409 on stale version', async () => {
  await runConflictDrill('navigation', 'nav_e2e_conflict', navigationBody());
});
