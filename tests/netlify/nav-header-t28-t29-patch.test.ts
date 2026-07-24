/**
 * T2.8+T2.9 offline verification: the combined nav_header patch
 * (scripts/patch-nav-header-t28-t29.mjs / scripts/lib/nav-header-t28-t29-patch.mjs)
 * must apply cleanly through the REAL T0.6 patch-apply engine, starting from
 * the actual published nav_header body (the verbatim T2.2 seed — confirmed
 * byte-identical to the live production record, T2.3), and the result must
 * validate with zero blockers and ZERO warnings (the duplicate-target
 * warning disappears with the duplicate).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCandidatePatch, summarizeValidation } from '../../netlify/lib/object-validate.js';
import { applyPatchOps } from '../../packages/core/lib/object-patch-apply.js';
import type { ObjectRecord, Principal } from '../../packages/core/schema/object-record-v1.js';
import { navHeaderBody } from '../../scripts/lib/navigation-seed-data.mjs';
import {
  NAV_HEADER_T28_T29_OPS,
  classifyNavHeaderPatchState,
  hasNavItem,
  hasNewsletterAction,
} from '../../scripts/lib/nav-header-t28-t29-patch.mjs';

const TEST_ACTOR: Principal = { kind: 'agent', agent_name: 'test', auth: 'publish_key' };

// validateCandidatePatch reports eligibility but not the applied body itself;
// re-derive it via the same T0.6 engine to assert on its exact shape.
const applyOps = (record: ObjectRecord<unknown>, ops: readonly unknown[]) =>
  applyPatchOps(record, ops, { actor: TEST_ACTOR, at: '2026-07-06T00:00:00.000Z' }).record.body;

const navHeaderRecord = (): ObjectRecord<unknown> => ({
  object_id: 'nav_header',
  object_type: 'navigation',
  schema_version: 'navigation.v1',
  site: 'site_drlurie',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  status: 'active',
  body: navHeaderBody,
  publication: { published_time: '2026-07-06T00:00:00.000Z' },
  history: [],
  version: 8,
  content_revision: 4,
});

test('classifyNavHeaderPatchState: the live seed body is pre-patch', () => {
  assert.equal(classifyNavHeaderPatchState(navHeaderBody), 'pre-patch');
  assert.equal(hasNavItem(navHeaderBody, 'g_solutions', 'i_early_access'), true);
  assert.equal(hasNewsletterAction(navHeaderBody), false);
});

test('T2.8+T2.9 ops apply via the real T0.6 engine: item removed, action added, nothing else touched', () => {
  const result = validateCandidatePatch(navHeaderRecord(), NAV_HEADER_T28_T29_OPS);
  assert.equal(result.applyError, undefined, JSON.stringify(result.applyError));
  assert.equal(result.eligible, true, JSON.stringify(summarizeValidation(result.groups)));

  const applied = applyOps(navHeaderRecord(), NAV_HEADER_T28_T29_OPS);
  assert.equal(classifyNavHeaderPatchState(applied), 'post-patch');
  assert.equal(hasNavItem(applied, 'g_solutions', 'i_early_access'), false);
  assert.equal(hasNewsletterAction(applied), true);

  // Untouched: the other two legs of the audited triple survive verbatim.
  assert.equal(hasNavItem(applied, 'g_solutions', 'i_join_early_access'), true);
  assert.deepEqual(
    (applied as { actions: Array<{ label: string }> }).actions.map((action) => action.label),
    ['Join Early Access', 'Join Newsletter']
  );
});

test('post-patch validation: zero blockers AND zero warnings (the duplicate-target warning is gone)', () => {
  const result = validateCandidatePatch(navHeaderRecord(), NAV_HEADER_T28_T29_OPS);
  const summary = summarizeValidation(result.groups);
  assert.deepEqual(summary.blockers, []);
  assert.deepEqual(summary.warnings, [], JSON.stringify(summary.warnings));
});

test('classifyNavHeaderPatchState reports partial for a half-applied record (defensive coverage)', () => {
  const onlyNewsletterAdded = {
    ...navHeaderBody,
    actions: [
      ...navHeaderBody.actions,
      { label: 'Join Newsletter', target: { kind: 'route', href: '/newsletter' }, style: 'primary' },
    ],
  };
  assert.equal(classifyNavHeaderPatchState(onlyNewsletterAdded), 'partial');
});
