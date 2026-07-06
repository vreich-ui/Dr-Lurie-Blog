#!/usr/bin/env node
/**
 * T2.7 (agent side) — the acceptance drill: "update the footer CTA".
 *
 * The drill proves the full agent-edit workflow end to end on the live Tier 3
 * flow, using a deliberately trivial change: the `nav_footer` 'Early Access'
 * link (g_next_steps / i_early_access) becomes 'Get Early Access', goes
 * through human review + publish, and is then reverted through the exact same
 * cycle. Both records' history entries (checkout → patch → submit → approve →
 * publish, with actors) are the acceptance evidence — attach them to the task
 * notes.
 *
 * Two legs, run separately, each gated on a human publish in between:
 *
 *   node scripts/drill-footer-cta.mjs                    # dry run (ops only)
 *   node scripts/drill-footer-cta.mjs --verify           # READ-ONLY state report
 *   node scripts/drill-footer-cta.mjs --execute-forward  # leg 1: 'Early Access' → 'Get Early Access'
 *       ... Wolf reviews + approves + publishes at /admin/objects/nav_footer ...
 *   node scripts/drill-footer-cta.mjs --execute-revert   # leg 2: back to 'Early Access'
 *       ... Wolf reviews + approves + publishes again ...
 *
 * PRE-FLIGHT (same discipline as patch-nav-header-t28-t29.mjs): each leg
 * fetches the live record first and refuses to run unless the record is in
 * that leg's expected starting shape — forward requires the baseline label,
 * revert requires the drilled label. Reruns are therefore safe: a leg that
 * already landed reports so and does nothing.
 *
 * Validation expectation: nav_footer's profile is zero blockers and zero
 * warnings, and a label-only change keeps it that way (targets are untouched,
 * so no duplicate-target warning can appear). Offline-verified against the
 * real T0.6/T0.7 engine in tests/netlify/nav-footer-t27-drill.test.ts.
 *
 * Env: PUBLISH_SECRET (required for the execute legs and --verify), OBJECT_STORE_BASE_URL
 * (default http://localhost:8888).
 */
import { createObjectStoreClient } from './lib/object-store-client.mjs';
import {
  NAV_FOOTER_OBJECT_ID,
  NAV_FOOTER_T27_FORWARD_OPS,
  NAV_FOOTER_T27_REVERT_OPS,
  classifyNavFooterDrillState,
  getDrillItemLabel,
} from './lib/nav-footer-t27-drill.mjs';

const AGENT_NAME = 'phase-2-t27-drill';

const args = new Set(process.argv.slice(2));
const executeForward = args.has('--execute-forward');
const executeRevert = args.has('--execute-revert');
const verify = args.has('--verify');
const baseUrl = process.env.OBJECT_STORE_BASE_URL || 'http://localhost:8888';

const STATE_LABEL = {
  baseline: "BASELINE — label 'Early Access' (ready for --execute-forward)",
  drilled: "DRILLED — label 'Get Early Access' (ready for --execute-revert)",
  other: 'OTHER — item missing or unexpected label (inspect manually; no leg may run)',
};

if (executeForward && executeRevert) {
  console.error('[drill-t27] Pass exactly one of --execute-forward / --execute-revert, not both.');
  process.exit(2);
}

if (!executeForward && !executeRevert && !verify) {
  console.info('[drill-t27] Dry run. Leg 1 (--execute-forward) ops:');
  console.log(JSON.stringify(NAV_FOOTER_T27_FORWARD_OPS, null, 2));
  console.info('[drill-t27] Leg 2 (--execute-revert) ops:');
  console.log(JSON.stringify(NAV_FOOTER_T27_REVERT_OPS, null, 2));
  console.info(
    '\n[drill-t27] Re-run with --verify (read-only state report) or one --execute-* leg ' +
      '(PUBLISH_SECRET + OBJECT_STORE_BASE_URL set). Each leg ends at submit_review; the publish is human-executed.'
  );
  process.exit(0);
}

const publishSecret = process.env.PUBLISH_SECRET;
if (!publishSecret) {
  console.error('[drill-t27] PUBLISH_SECRET is required. Keep it server-side only.');
  process.exit(2);
}

const call = createObjectStoreClient({ baseUrl, publishSecret, agentName: AGENT_NAME });

if (verify) {
  const existing = await call({ action: 'get', object_type: 'navigation', object_id: NAV_FOOTER_OBJECT_ID });
  if (existing.status !== 200) {
    console.error(`[verify] get failed (${existing.status}): ${JSON.stringify(existing.body)}`);
    process.exit(1);
  }
  const record = existing.body.record ?? {};
  const state = classifyNavFooterDrillState(record.body);
  console.info(
    `[verify] nav_footer: ${STATE_LABEL[state]} ` +
      `(version ${record.version}, content_revision ${record.content_revision}, review ${record.review?.state ?? 'none'}, lock ${record.lock ? 'HELD' : 'free'})`
  );
  process.exit(0);
}

// ─── --execute-forward / --execute-revert ───────────────────────────────────

const leg = executeForward
  ? { name: 'forward', requiredState: 'baseline', ops: NAV_FOOTER_T27_FORWARD_OPS, toLabel: 'Get Early Access' }
  : { name: 'revert', requiredState: 'drilled', ops: NAV_FOOTER_T27_REVERT_OPS, toLabel: 'Early Access' };

const existing = await call({ action: 'get', object_type: 'navigation', object_id: NAV_FOOTER_OBJECT_ID });
if (existing.status !== 200) {
  console.error(`[drill-t27] PRE-FLIGHT FAILED — get returned ${existing.status}; not patching.`);
  process.exit(1);
}
const preState = classifyNavFooterDrillState(existing.body.record?.body);
if (preState !== leg.requiredState) {
  console.error(
    `[drill-t27] PRE-FLIGHT FAILED — the ${leg.name} leg requires ${STATE_LABEL[leg.requiredState]}, ` +
      `but nav_footer is: ${STATE_LABEL[preState]}. Not patching. Run --verify for detail.`
  );
  process.exit(1);
}
console.info(
  `[drill-t27] pre-flight OK — nav_footer is in the ${leg.requiredState} state; running the ${leg.name} leg.`
);

const checkout = await call({ action: 'checkout', object_type: 'navigation', object_id: NAV_FOOTER_OBJECT_ID });
if (checkout.status !== 200) {
  console.error(`[drill-t27] checkout failed (${checkout.status}): ${JSON.stringify(checkout.body)}`);
  process.exit(1);
}
const lockToken = checkout.body.lockToken;
const expectedRecordVersion = checkout.body.record_version;

const patched = await call({
  action: 'patch',
  object_type: 'navigation',
  object_id: NAV_FOOTER_OBJECT_ID,
  lock_token: lockToken,
  expected_record_version: expectedRecordVersion,
  ops: leg.ops,
});
if (patched.status !== 200) {
  console.error(`[drill-t27] patch failed (${patched.status}): ${JSON.stringify(patched.body)}`);
  await call({ action: 'checkin', object_type: 'navigation', object_id: NAV_FOOTER_OBJECT_ID, lock_token: lockToken });
  process.exit(1);
}
const warnings = (patched.body.validation_summary?.warnings ?? []).map((warning) => warning.id);
console.info(
  `[drill-t27] patched (version ${patched.body.version}, content_revision ${patched.body.content_revision}); ` +
    `${warnings.length ? `warnings: ${warnings.join(', ')} (UNEXPECTED for a label-only change — inspect before review)` : 'zero warnings, as expected for a label-only change'}.`
);

// Tier 3 regression check: agent publish must still be refused.
const attempt = await call({
  action: 'publish_by_time',
  object_type: 'navigation',
  object_id: NAV_FOOTER_OBJECT_ID,
  lock_token: lockToken,
});
if (attempt.status === 403) {
  console.info(`[drill-t27] agent publish refused as required (403 ${attempt.body.code ?? ''}).`);
} else {
  console.error(
    `[drill-t27] TIER 3 REGRESSION — agent publish was NOT refused (got ${attempt.status}: ${JSON.stringify(attempt.body)}). ` +
      'STOP: do not proceed to a human publish until this is understood.'
  );
}

const submit = await call({
  action: 'submit_review',
  object_type: 'navigation',
  object_id: NAV_FOOTER_OBJECT_ID,
  lock_token: lockToken,
  note:
    `T2.7 drill (${leg.name} leg): footer CTA label → '${leg.toLabel}'. One-word label change on ` +
    'g_next_steps/i_early_access — the field diff should show exactly that word-diff and nothing else. ' +
    'This is the acceptance drill for the agent-edit workflow; publish is yours to execute (immediate). ' +
    (leg.name === 'forward'
      ? "After it is live, the agent runs --execute-revert to put 'Early Access' back through the same cycle."
      : 'This closes the drill — after publish, both records of history are the acceptance evidence.'),
});
if (submit.status === 200) {
  console.info(`[drill-t27] submitted for review (state ${submit.body.review?.state ?? 'open'}).`);
} else {
  console.error(`[drill-t27] submit_review failed (${submit.status}): ${JSON.stringify(submit.body)}`);
}

const checkin = await call({
  action: 'checkin',
  object_type: 'navigation',
  object_id: NAV_FOOTER_OBJECT_ID,
  lock_token: lockToken,
});
if (checkin.status !== 200) {
  console.error(`[drill-t27] checkin failed (${checkin.status}): ${JSON.stringify(checkin.body)}`);
  process.exit(1);
}

console.info(
  `[drill-t27] ${leg.name} leg submitted. NEXT (human, Wolf): review + approve + publish nav_footer at /admin/objects/nav_footer` +
    `${leg.name === 'forward' ? ", then the agent runs --execute-revert once 'Get Early Access' is live." : ' — that completes T2.7.'}`
);
console.info(
  `[drill-t27] current live label stays '${getDrillItemLabel(existing.body.record?.body)}' until that publish.`
);
