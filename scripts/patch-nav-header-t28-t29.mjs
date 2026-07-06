#!/usr/bin/env node
/**
 * T2.8 + T2.9 (agent side) — one combined patch on `nav_header`, submitted as
 * a single Tier 3 review, covering both post-cutover decisions queued behind
 * T2.5:
 *
 *   T2.9 (decided, Wolf 2026-07-06): remove the 'Early Access' dropdown item
 *     (`i_early_access`) from the Solutions group. Keeps 'Join Early Access'
 *     (`i_join_early_access`) and the header action untouched. This also
 *     resolves nav_header's standing duplicate-target warning — removing the
 *     item removes the duplicate, so the post-patch validation report is
 *     expected to carry ZERO warnings (down from the one duplicate warning
 *     the seed/T2.3 record has carried since publish).
 *
 *   T2.8 (settled, S-2): the newsletter CTA becomes a plain, identical,
 *     all-device action — no viewport-conditional schema field, ever
 *     (standing principle, 05 §1). Adds `upsert_action {label:'Join
 *     Newsletter', target:{kind:'route', href:'/newsletter'}, style:
 *     'primary'}`. Per Wolf's explicit instruction (2026-07-06): BOTH CTAs
 *     coexist — the existing 'Join Early Access' action is NOT trimmed.
 *     The data half lands here; the chrome half (Header.astro rendering
 *     `actions` on both mobile and desktop, replacing the hardcoded
 *     mobile-only CTA) is a separate, ordinary code commit that must not
 *     merge to `main` until AFTER this patch is live — see the sequencing
 *     note on that commit. Landing the chrome change first would make the
 *     mobile newsletter CTA vanish (Header.astro would start rendering
 *     `actions`, which today holds only 'Join Early Access') before its
 *     replacement exists — a live regression, not merely an early rollout.
 *
 * Combined into one patch/review/publish cycle (rather than two) because
 * both ops land on the same object in the same sitting and Wolf is the one
 * clicking through the admin UI each time — one review to read, one publish
 * to click, one structural diff showing exactly: one item removed, one
 * action added.
 *
 * PRE-FLIGHT (same discipline as submit-navigation-review.mjs): before
 * taking the lock, this script fetches the live `nav_header` record and
 * refuses to proceed unless its CURRENT state is exactly the pre-patch shape
 * (see scripts/lib/nav-header-t28-t29-patch.mjs). This makes reruns safe: if
 * the patch already landed (or something else changed the record), the
 * script says so and does nothing, rather than silently re-patching or
 * drifting.
 *
 * Usage:
 *   node scripts/patch-nav-header-t28-t29.mjs                # dry run
 *   node scripts/patch-nav-header-t28-t29.mjs --verify        # READ-ONLY:
 *       report whether nav_header currently has the pre-patch shape, the
 *       post-patch shape, or something else entirely.
 *   node scripts/patch-nav-header-t28-t29.mjs --execute       # patch + submit
 *
 * Env: PUBLISH_SECRET (required for --execute/--verify), OBJECT_STORE_BASE_URL
 * (default http://localhost:8888).
 *
 * After --execute succeeds: Wolf reviews the structural diff (expect exactly
 * one removed item, one added action, zero warnings) at
 * /admin/objects/nav_header, approves, and publishes — human-executed, Tier 3,
 * same as T2.3. Only after that publish is live should the Header.astro
 * chrome commit be merged.
 */
import { createObjectStoreClient } from './lib/object-store-client.mjs';
import {
  NAV_HEADER_OBJECT_ID,
  NAV_HEADER_T28_T29_OPS,
  classifyNavHeaderPatchState,
} from './lib/nav-header-t28-t29-patch.mjs';

const AGENT_NAME = 'phase-2-t28-t29-patch';

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const verify = args.has('--verify');
const baseUrl = process.env.OBJECT_STORE_BASE_URL || 'http://localhost:8888';

const STATE_LABEL = {
  'pre-patch': 'PRE-PATCH (expected before running --execute)',
  'post-patch': 'POST-PATCH (T2.8+T2.9 already applied)',
  partial: 'PARTIAL — one op applied without the other (unexpected; inspect manually)',
};

if (!execute && !verify) {
  console.info('[patch-t28-t29] Dry run. Ops --execute would submit for nav_header:');
  console.log(JSON.stringify(NAV_HEADER_T28_T29_OPS, null, 2));
  console.info(
    '\n[patch-t28-t29] Re-run with --execute (PUBLISH_SECRET + OBJECT_STORE_BASE_URL set) to patch + submit,'
  );
  console.info('[patch-t28-t29] or --verify to read-only report the current shape of nav_header.');
  process.exit(0);
}

const publishSecret = process.env.PUBLISH_SECRET;
if (!publishSecret) {
  console.error('[patch-t28-t29] PUBLISH_SECRET is required. Keep it server-side only.');
  process.exit(2);
}

const call = createObjectStoreClient({ baseUrl, publishSecret, agentName: AGENT_NAME });

if (verify) {
  const existing = await call({ action: 'get', object_type: 'navigation', object_id: NAV_HEADER_OBJECT_ID });
  if (existing.status !== 200) {
    console.error(`[verify] get failed (${existing.status}): ${JSON.stringify(existing.body)}`);
    process.exit(1);
  }
  const record = existing.body.record ?? {};
  const state = classifyNavHeaderPatchState(record.body);
  console.info(
    `[verify] nav_header: ${STATE_LABEL[state]} ` +
      `(version ${record.version}, content_revision ${record.content_revision}, review ${record.review?.state ?? 'none'}, lock ${record.lock ? 'HELD' : 'free'})`
  );
  process.exit(0);
}

// ─── --execute ────────────────────────────────────────────────────────────

const existing = await call({ action: 'get', object_type: 'navigation', object_id: NAV_HEADER_OBJECT_ID });
if (existing.status !== 200) {
  console.error(`[patch-t28-t29] PRE-FLIGHT FAILED — get returned ${existing.status}; not patching.`);
  process.exit(1);
}
const preState = classifyNavHeaderPatchState(existing.body.record?.body);
if (preState !== 'pre-patch') {
  console.error(
    `[patch-t28-t29] PRE-FLIGHT FAILED — nav_header is not in the expected pre-patch state (${STATE_LABEL[preState]}); ` +
      'not patching. Run --verify for detail.'
  );
  process.exit(1);
}
console.info('[patch-t28-t29] pre-flight OK — nav_header is in the expected pre-patch state.');

const checkout = await call({ action: 'checkout', object_type: 'navigation', object_id: NAV_HEADER_OBJECT_ID });
if (checkout.status !== 200) {
  console.error(`[patch-t28-t29] checkout failed (${checkout.status}): ${JSON.stringify(checkout.body)}`);
  process.exit(1);
}
const lockToken = checkout.body.lockToken;
const expectedRecordVersion = checkout.body.record_version;

const patched = await call({
  action: 'patch',
  object_type: 'navigation',
  object_id: NAV_HEADER_OBJECT_ID,
  lock_token: lockToken,
  expected_record_version: expectedRecordVersion,
  ops: NAV_HEADER_T28_T29_OPS,
});
if (patched.status !== 200) {
  console.error(`[patch-t28-t29] patch failed (${patched.status}): ${JSON.stringify(patched.body)}`);
  await call({ action: 'checkin', object_type: 'navigation', object_id: NAV_HEADER_OBJECT_ID, lock_token: lockToken });
  process.exit(1);
}
const warnings = (patched.body.validation_summary?.warnings ?? []).map((warning) => warning.id);
console.info(
  `[patch-t28-t29] patched (version ${patched.body.version}, content_revision ${patched.body.content_revision}); ` +
    `${warnings.length ? `warnings: ${warnings.join(', ')}` : 'zero warnings (the duplicate-target warning is gone, as expected)'}.`
);

// Tier 3 regression check: agent publish must still be refused.
const attempt = await call({
  action: 'publish_by_time',
  object_type: 'navigation',
  object_id: NAV_HEADER_OBJECT_ID,
  lock_token: lockToken,
});
if (attempt.status === 403) {
  console.info(`[patch-t28-t29] agent publish refused as required (403 ${attempt.body.code ?? ''}).`);
} else {
  console.error(
    `[patch-t28-t29] TIER 3 REGRESSION — agent publish was NOT refused (got ${attempt.status}: ${JSON.stringify(attempt.body)}). ` +
      'STOP: do not proceed to a human publish until this is understood.'
  );
}

const submit = await call({
  action: 'submit_review',
  object_type: 'navigation',
  object_id: NAV_HEADER_OBJECT_ID,
  lock_token: lockToken,
  note:
    "T2.8+T2.9 combined: remove the 'Early Access' Solutions item (Wolf, 2026-07-06 — duplicate-target " +
    "cleanup) and add the all-device 'Join Newsletter' header action (S-2 settled decision — both CTAs " +
    "coexist, 'Join Early Access' is unchanged). Structural diff should show exactly one removed item and " +
    'one added action, with zero remaining warnings. Publish is yours to execute — immediate, no schedule. ' +
    'Do NOT merge the Header.astro chrome commit rendering these actions until after this publish is live.',
});
if (submit.status === 200) {
  console.info(`[patch-t28-t29] submitted for review (state ${submit.body.review?.state ?? 'open'}).`);
} else {
  console.error(`[patch-t28-t29] submit_review failed (${submit.status}): ${JSON.stringify(submit.body)}`);
}

const checkin = await call({
  action: 'checkin',
  object_type: 'navigation',
  object_id: NAV_HEADER_OBJECT_ID,
  lock_token: lockToken,
});
if (checkin.status !== 200) {
  console.error(`[patch-t28-t29] checkin failed (${checkin.status}): ${JSON.stringify(checkin.body)}`);
  process.exit(1);
}

console.info(
  '[patch-t28-t29] Done. NEXT (human, Wolf): review + approve + publish nav_header in /admin/objects/nav_header.'
);
console.info('[patch-t28-t29] Once that publish is live on main, the Header.astro chrome commit is safe to merge.');
