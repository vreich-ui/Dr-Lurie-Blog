#!/usr/bin/env node
/**
 * T2.2 — seed the three Phase 2 Navigation objects (nav_header, nav_footer,
 * nav_footer_home) into the site-objects store via `object_create`, then
 * verify each with `object_validate`.
 *
 * The record bodies live in scripts/lib/navigation-seed-data.mjs (the
 * C§1.2–1.4 mapping tables as literals — the mapping is the spec). This
 * script only transports them; it never edits content. Local (offline)
 * verification of the same data — schema, exactly-one-duplicate-warning,
 * materializer snapshot, prop-shape round-trip — lives in
 * tests/netlify/navigation-seed.test.ts and runs with `npm test`.
 *
 * Usage:
 *   node scripts/seed-navigation.mjs                # dry run: print payloads
 *   node scripts/seed-navigation.mjs --execute      # create + validate
 *
 * Env (for --execute):
 *   PUBLISH_SECRET             the shared x-publish-key (server-side only)
 *   OBJECT_STORE_BASE_URL      deployment base URL
 *                              (default http://localhost:8888 for netlify dev)
 *
 * Idempotency: an existing record (409) is re-fetched and compared to the
 * seed body — identical → OK (re-run safe); different → loud failure, because
 * a drifted nav_* record means someone has edited the draft and re-seeding
 * must not clobber it (fix by hand or with patch ops, not by re-running).
 *
 * Seeding creates DRAFT records only. Nothing on the live site changes until
 * the Tier 3 publish (T2.3), which is human-executed by design (C§2.2).
 */
import { NAVIGATION_SEEDS, NAVIGATION_SEED_SITE } from './lib/navigation-seed-data.mjs';

const AGENT_NAME = 'phase-2-navigation-seed';

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const baseUrl = (process.env.OBJECT_STORE_BASE_URL || 'http://localhost:8888').replace(/\/$/, '');
const endpoint = `${baseUrl}/.netlify/functions/object-store`;

if (!execute) {
  console.info('[seed-navigation] Dry run. Records that --execute would create:');
  for (const seed of NAVIGATION_SEEDS) {
    console.info(`\n─── ${seed.objectId} ` + '─'.repeat(Math.max(0, 60 - seed.objectId.length)));
    console.log(
      JSON.stringify(
        {
          action: 'create',
          object_type: 'navigation',
          site: NAVIGATION_SEED_SITE,
          requested_id: seed.objectId,
          body: seed.body,
        },
        null,
        2
      )
    );
  }
  console.info('\n[seed-navigation] Re-run with --execute (PUBLISH_SECRET + OBJECT_STORE_BASE_URL set) to create.');
  process.exit(0);
}

const publishSecret = process.env.PUBLISH_SECRET;
if (!publishSecret) {
  console.error('[seed-navigation] PUBLISH_SECRET is required with --execute. Keep it server-side only.');
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

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    );
  return value;
};
const sameBody = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

const warningIds = (validation) =>
  (validation ?? [])
    .flatMap((group) => group.criteria ?? [])
    .filter((criterion) => criterion.status === 'warning')
    .map((criterion) => criterion.id);
const blockerMessages = (validation) =>
  (validation ?? [])
    .flatMap((group) => group.criteria ?? [])
    .filter((criterion) => criterion.status === 'missing')
    .map((criterion) => `${criterion.id}: ${criterion.message}`);

let failed = false;

for (const seed of NAVIGATION_SEEDS) {
  const label = `[seed-navigation] ${seed.objectId}`;

  const created = await call({
    action: 'create',
    object_type: 'navigation',
    site: NAVIGATION_SEED_SITE,
    requested_id: seed.objectId,
    body: seed.body,
  });

  if (created.status === 200) {
    console.info(`${label}: created (version ${created.body.record?.version}).`);
  } else if (created.status === 409) {
    const existing = await call({ action: 'get', object_type: 'navigation', object_id: seed.objectId });
    if (existing.status === 200 && sameBody(existing.body.record?.body, seed.body)) {
      console.info(`${label}: already exists with the identical body — OK (idempotent re-run).`);
    } else {
      console.error(
        `${label}: already exists with a DIFFERENT body (version ${existing.body.record?.version}, ` +
          `content_revision ${existing.body.record?.content_revision}). Refusing to touch it — the draft has been ` +
          'edited since seeding. Reconcile by hand or with patch ops.'
      );
      failed = true;
      continue;
    }
  } else {
    console.error(`${label}: create failed (${created.status}):`, JSON.stringify(created.body, null, 2));
    failed = true;
    continue;
  }

  const validated = await call({ action: 'validate', object_type: 'navigation', object_id: seed.objectId });
  if (validated.status !== 200) {
    console.error(`${label}: validate failed (${validated.status}):`, JSON.stringify(validated.body, null, 2));
    failed = true;
    continue;
  }
  const blockers = blockerMessages(validated.body.validation);
  const warnings = warningIds(validated.body.validation);
  const expected = JSON.stringify([...seed.expectedWarningIds].sort());
  if (blockers.length > 0) {
    console.error(`${label}: unexpected hard failures: ${blockers.join(' | ')}`);
    failed = true;
  } else if (JSON.stringify([...warnings].sort()) !== expected) {
    console.error(
      `${label}: warning set mismatch — expected ${expected}, got ${JSON.stringify(warnings.sort())}. ` +
        '(nav_header must carry exactly the duplicate-target warning; the footers none.)'
    );
    failed = true;
  } else {
    console.info(
      `${label}: validates clean${warnings.length ? ` with the expected warning (${warnings.join(', ')})` : ' with zero warnings'}.`
    );
  }
}

if (failed) {
  console.error('[seed-navigation] FAILED — see above. Nothing was published; drafts may need reconciling.');
  process.exit(1);
}
console.info('[seed-navigation] All three navigation drafts are in place and validate as expected.');
console.info(
  '[seed-navigation] Next: T2.3 — submit for review (scripts/submit-navigation-review.mjs), then the HUMAN-EXECUTED Tier 3 publish.'
);
