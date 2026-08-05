/**
 * Offline verification: the Fernwell admin-nav-group patch
 * (scripts/patch-fernwell-admin-nav.mjs / scripts/lib/fernwell-admin-nav-patch.mjs)
 * must apply cleanly through the REAL T0.6 patch-apply engine, starting from
 * the live nav_header body (the committed seed — a bare g_primary/Home group,
 * matching the production record byte-for-byte, T14.9), and the result must
 * validate with zero blockers: g_admin inserted at position 1, g_primary
 * untouched.
 */
import '../../sites/fernwell/config/policy-bindings.js'; // W11: register site providers (tests exercise the fernwell-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCandidatePatch, summarizeValidation } from '../../packages/core/server/lib/object-validate.js';
import { applyPatchOps } from '../../packages/core/lib/object-patch-apply.js';
import type { ObjectRecord, Principal } from '../../packages/core/schema/object-record-v1.js';
import { navHeaderBody } from '../../sites/fernwell/seeds/navigation-seed-data.mjs';
import {
  NAV_HEADER_OBJECT_ID,
  FERNWELL_ADMIN_NAV_OPS,
  hasAdminGroup,
} from '../../scripts/lib/fernwell-admin-nav-patch.mjs';

const TEST_ACTOR: Principal = { kind: 'agent', agent_name: 'test', auth: 'publish_key' };

type NavGroupOut = { id: string; adminOnly?: boolean; items: Array<{ id: string; label: string }> };
type NavBodyOut = { groups: NavGroupOut[] };

const applyOps = (record: ObjectRecord<unknown>, ops: readonly unknown[]) =>
  applyPatchOps(record, ops, { actor: TEST_ACTOR, at: '2026-08-05T00:00:00.000Z' }).record.body as NavBodyOut;

const navHeaderRecord = (): ObjectRecord<unknown> => ({
  object_id: NAV_HEADER_OBJECT_ID,
  object_type: 'navigation',
  schema_version: 'navigation.v1',
  site: 'site_fernwell',
  created_at: '2026-07-27T08:48:21.683Z',
  updated_at: '2026-07-27T08:48:21.683Z',
  status: 'active',
  body: navHeaderBody,
  publication: { published_time: '2026-07-27T08:48:21.683Z' },
  history: [],
  version: 2,
  content_revision: 1,
});

test('the live seed body has no admin group yet', () => {
  assert.equal(hasAdminGroup(navHeaderBody), false);
});

test('the admin-nav-group op applies via the real T0.6 engine: g_admin inserted at position 1', () => {
  const result = validateCandidatePatch(navHeaderRecord(), FERNWELL_ADMIN_NAV_OPS);
  assert.equal(result.applyError, undefined, JSON.stringify(result.applyError));
  assert.equal(result.eligible, true, JSON.stringify(summarizeValidation(result.groups)));

  const applied = applyOps(navHeaderRecord(), FERNWELL_ADMIN_NAV_OPS);
  assert.equal(hasAdminGroup(applied), true);
  assert.equal(applied.groups.length, 2);
  assert.equal(applied.groups[0].id, 'g_primary'); // untouched, still first
  assert.equal(applied.groups[1].id, 'g_admin'); // inserted at position 1
  assert.equal(applied.groups[1].adminOnly, true);
  assert.deepEqual(
    applied.groups[1].items.map((item) => item.label),
    ['Dashboard', 'Content library', 'Agents', 'Maintenance']
  );
  assert.deepEqual(
    applied.groups[1].items.map((item) => item.id),
    ['i_admin_dashboard', 'i_admin_content', 'i_admin_agents', 'i_admin_maintenance']
  );
});

test('post-patch validation: zero blockers', () => {
  const result = validateCandidatePatch(navHeaderRecord(), FERNWELL_ADMIN_NAV_OPS);
  const summary = summarizeValidation(result.groups);
  assert.deepEqual(summary.blockers, []);
});
