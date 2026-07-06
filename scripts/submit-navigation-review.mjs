#!/usr/bin/env node
/**
 * T2.3 (agent side) — submit the three seeded Navigation drafts for review.
 *
 * This script drives everything an agent principal MAY do for the first
 * Tier 3 publish, and nothing it may not (C§2.2: navigation publish is
 * human-executed, always):
 *
 *   per record: checkout → agent publish attempt (MUST be refused, 403 —
 *   the Tier 3 regression check in production config) → submit_review →
 *   checkin (review state survives checkin; the record is left unlocked
 *   for the human publisher).
 *
 * No requested_publish_action is sent: the M-6 publish-action pin exists for
 * Tier 2 AGENT-executed publishes; here the publish itself is Wolf's act and
 * humans carry publish authority in themselves (C§2.2).
 *
 * After approval (and BEFORE the human publish), `--verify-tier3` re-checks
 * the stronger half of the regression: an agent attempt is still refused
 * even WITH an approved review on the record.
 *
 * Usage:
 *   node scripts/submit-navigation-review.mjs                 # dry run
 *   node scripts/submit-navigation-review.mjs --execute       # submit all three
 *   node scripts/submit-navigation-review.mjs --verify-tier3  # post-approval refusal check
 *
 * Env: PUBLISH_SECRET (required), OBJECT_STORE_BASE_URL (default
 * http://localhost:8888). The human steps live in
 * docs/cms-architecture/cms-pipeline/phase-2-runbook.md.
 */
import { NAVIGATION_SEEDS } from './lib/navigation-seed-data.mjs';

const AGENT_NAME = 'phase-2-navigation-seed';
const NAV_IDS = NAVIGATION_SEEDS.map((seed) => seed.objectId);

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const verifyTier3 = args.has('--verify-tier3');
const baseUrl = (process.env.OBJECT_STORE_BASE_URL || 'http://localhost:8888').replace(/\/$/, '');
const endpoint = `${baseUrl}/.netlify/functions/object-store`;

if (!execute && !verifyTier3) {
  console.info('[submit-review] Dry run. --execute would, for each of:', NAV_IDS.join(', '));
  console.info('  1. checkout                      (object-store action=checkout)');
  console.info('  2. publish attempt as agent      (action=publish_by_time — EXPECTED to be refused, 403 Tier 3)');
  console.info('  3. submit_review                 (action=submit_review, note, no requested_publish_action)');
  console.info('  4. checkin                       (record left unlocked for the human publisher)');
  console.info('Then Wolf approves + publishes in the admin objects editor (see phase-2-runbook.md).');
  console.info('After approving, run --verify-tier3 to confirm an agent publish is refused even with approval.');
  process.exit(0);
}

const publishSecret = process.env.PUBLISH_SECRET;
if (!publishSecret) {
  console.error('[submit-review] PUBLISH_SECRET is required. Keep it server-side only.');
  process.exit(2);
}

const call = async (payload) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publish-key': publishSecret },
    body: JSON.stringify({ agent_name: AGENT_NAME, ...payload }),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
};

let failed = false;
const fail = (message) => {
  console.error(message);
  failed = true;
};

for (const objectId of NAV_IDS) {
  const label = `[submit-review] ${objectId}`;

  const checkout = await call({ action: 'checkout', object_type: 'navigation', object_id: objectId });
  if (checkout.status !== 200) {
    fail(`${label}: checkout failed (${checkout.status}): ${JSON.stringify(checkout.body)}`);
    continue;
  }
  const lockToken = checkout.body.lockToken;
  if (!lockToken) {
    fail(`${label}: checkout returned no lock token: ${JSON.stringify(checkout.body)}`);
    continue;
  }

  // Tier 3 regression check: the publish attempt by an agent principal MUST
  // be refused (403) — approval state is irrelevant to this rule.
  const attempt = await call({
    action: 'publish_by_time',
    object_type: 'navigation',
    object_id: objectId,
    lock_token: lockToken,
  });
  if (attempt.status === 403) {
    console.info(`${label}: agent publish refused as required (403 ${attempt.body.code ?? ''}).`);
  } else {
    fail(
      `${label}: TIER 3 REGRESSION — agent publish was NOT refused with 403 (got ${attempt.status}: ` +
        `${JSON.stringify(attempt.body)}). STOP: do not proceed to a human publish until this is understood.`
    );
  }

  if (verifyTier3) {
    // Post-approval mode: only the refusal check + checkin; no resubmission
    // (a resubmission would be a no-op but muddies the review history).
    const checkin = await call({
      action: 'checkin',
      object_type: 'navigation',
      object_id: objectId,
      lock_token: lockToken,
    });
    if (checkin.status !== 200) fail(`${label}: checkin failed (${checkin.status}): ${JSON.stringify(checkin.body)}`);
    continue;
  }

  const submit = await call({
    action: 'submit_review',
    object_type: 'navigation',
    object_id: objectId,
    lock_token: lockToken,
    note:
      'T2.3 first Tier 3 publish: verbatim Phase 2 seed of the current site navigation ' +
      '(C§1.2–1.4; expected duplicate-target warning on nav_header is the audited Early Access pair). ' +
      'Publish is yours to execute — immediate publish, no schedule.',
  });
  if (submit.status === 200) {
    console.info(`${label}: submitted for review (state ${submit.body.review?.state ?? 'open'}).`);
  } else {
    fail(`${label}: submit_review failed (${submit.status}): ${JSON.stringify(submit.body)}`);
  }

  const checkin = await call({
    action: 'checkin',
    object_type: 'navigation',
    object_id: objectId,
    lock_token: lockToken,
  });
  if (checkin.status !== 200) fail(`${label}: checkin failed (${checkin.status}): ${JSON.stringify(checkin.body)}`);
}

if (failed) {
  console.error('[submit-review] FAILED — see above.');
  process.exit(1);
}
if (verifyTier3) {
  console.info('[submit-review] Tier 3 verified: agent publish attempts refused on all three records.');
  console.info('[submit-review] The human publish can proceed (phase-2-runbook.md step 3).');
} else {
  console.info('[submit-review] All three records submitted and unlocked.');
  console.info('[submit-review] NEXT (human, Wolf): review + approve + publish each record in /admin/objects/…');
  console.info('[submit-review] The full click-path is in docs/cms-architecture/cms-pipeline/phase-2-runbook.md.');
}
