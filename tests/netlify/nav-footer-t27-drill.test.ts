/**
 * T2.7 offline verification: both legs of the footer-CTA drill
 * (scripts/drill-footer-cta.mjs / scripts/lib/nav-footer-t27-drill.mjs) must
 * apply cleanly through the REAL T0.6 patch-apply engine, starting from the
 * actual published nav_footer body (the verbatim T2.2 seed — confirmed
 * byte-identical to the live production record, T2.3). A label-only change
 * must keep nav_footer's validation profile untouched: zero blockers, zero
 * warnings — and the revert leg must restore the seed body EXACTLY.
 */
import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCandidatePatch, summarizeValidation } from '../../packages/core/server/lib/object-validate.js';
import { applyPatchOps } from '../../packages/core/lib/object-patch-apply.js';
import type { ObjectRecord, Principal } from '../../packages/core/schema/object-record-v1.js';
import { navFooterBody } from '../../scripts/lib/navigation-seed-data.mjs';
import {
  NAV_FOOTER_T27_FORWARD_OPS,
  NAV_FOOTER_T27_REVERT_OPS,
  classifyNavFooterDrillState,
  getDrillItemLabel,
} from '../../scripts/lib/nav-footer-t27-drill.mjs';

const TEST_ACTOR: Principal = { kind: 'agent', agent_name: 'test', auth: 'publish_key' };

const applyOps = (record: ObjectRecord<unknown>, ops: readonly unknown[]) =>
  applyPatchOps(record, ops, { actor: TEST_ACTOR, at: '2026-07-06T00:00:00.000Z' }).record.body;

const navFooterRecord = (body: unknown = navFooterBody): ObjectRecord<unknown> => ({
  object_id: 'nav_footer',
  object_type: 'navigation',
  schema_version: 'navigation.v1',
  site: 'site_drlurie',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  status: 'active',
  body,
  publication: { published_time: '2026-07-06T00:00:00.000Z' },
  history: [],
  version: 8,
  content_revision: 4,
});

test('classifyNavFooterDrillState: the live seed body is baseline', () => {
  assert.equal(classifyNavFooterDrillState(navFooterBody), 'baseline');
  assert.equal(getDrillItemLabel(navFooterBody), 'Early Access');
});

test('forward leg applies via the real T0.6 engine: only the label changes, validation profile untouched', () => {
  const result = validateCandidatePatch(navFooterRecord(), NAV_FOOTER_T27_FORWARD_OPS);
  assert.equal(result.applyError, undefined, JSON.stringify(result.applyError));
  assert.equal(result.eligible, true, JSON.stringify(summarizeValidation(result.groups)));
  const summary = summarizeValidation(result.groups);
  assert.deepEqual(summary.blockers, []);
  assert.deepEqual(summary.warnings, [], JSON.stringify(summary.warnings));

  const drilled = applyOps(navFooterRecord(), NAV_FOOTER_T27_FORWARD_OPS);
  assert.equal(classifyNavFooterDrillState(drilled), 'drilled');
  assert.equal(getDrillItemLabel(drilled), 'Get Early Access');

  // Nothing but that one label moved: putting the original label back yields
  // the seed byte-for-byte, so the label is provably the only difference.
  const restored = structuredClone(drilled) as typeof navFooterBody;
  const item = restored.groups
    .find((group) => group.id === 'g_next_steps')!
    .items.find((candidate) => candidate.id === 'i_early_access')!;
  (item as { label: string }).label = 'Early Access';
  assert.deepEqual(restored, navFooterBody);
});

test('revert leg restores the seed body exactly (round-trip through the real engine)', () => {
  const drilled = applyOps(navFooterRecord(), NAV_FOOTER_T27_FORWARD_OPS);
  const revertResult = validateCandidatePatch(navFooterRecord(drilled), NAV_FOOTER_T27_REVERT_OPS);
  assert.equal(revertResult.applyError, undefined, JSON.stringify(revertResult.applyError));
  assert.equal(revertResult.eligible, true);

  const restored = applyOps(navFooterRecord(drilled), NAV_FOOTER_T27_REVERT_OPS);
  assert.equal(classifyNavFooterDrillState(restored), 'baseline');
  assert.deepEqual(restored, navFooterBody);
});

test('classifyNavFooterDrillState reports other for an unexpected label or missing item (defensive coverage)', () => {
  const renamed = structuredClone(navFooterBody);
  renamed.groups
    .find((group) => group.id === 'g_next_steps')!
    .items.find((candidate) => candidate.id === 'i_early_access')!.label = 'Something Else';
  assert.equal(classifyNavFooterDrillState(renamed), 'other');

  const removed = structuredClone(navFooterBody);
  const nextSteps = removed.groups.find((group) => group.id === 'g_next_steps')!;
  nextSteps.items = nextSteps.items.filter((candidate) => candidate.id !== 'i_early_access');
  assert.equal(classifyNavFooterDrillState(removed), 'other');
});
