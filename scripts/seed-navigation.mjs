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
 *   node scripts/seed-navigation.mjs --verify       # READ-ONLY: fetch each
 *       draft from the store and byte-compare its body against the seed;
 *       prints version/content_revision/review/lock state. Run this any time
 *       you need to know exactly what is in the drafts (e.g. before
 *       approving a review).
 *
 * Env (for --execute/--verify):
 *   PUBLISH_SECRET             the shared x-publish-key (server-side only)
 *   OBJECT_STORE_BASE_URL      deployment base URL
 *                              (default http://localhost:8888 for netlify dev)
 *
 * Validator-vintage note (learned from the first production run): the
 * duplicate-target warning on nav_header is produced by T2.1 code, which
 * only reaches production when the Phase 2 branch merges and deploys. When
 * the deployed validator predates T2.1 (no nav_* criteria in the report),
 * the warning check is SKIPPED WITH A NOTE instead of failing — zero
 * warnings there means the validator can't see duplicates, not that the
 * data lacks them. Hard failures (blockers) fail the run regardless.
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
import { checkValidationAgainstSeed, createObjectStoreClient, sameBody } from './lib/object-store-client.mjs';

const AGENT_NAME = 'phase-2-navigation-seed';

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const verify = args.has('--verify');
const baseUrl = process.env.OBJECT_STORE_BASE_URL || 'http://localhost:8888';

if (!execute && !verify) {
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
  console.info('\n[seed-navigation] Re-run with --execute (PUBLISH_SECRET + OBJECT_STORE_BASE_URL set) to create,');
  console.info('[seed-navigation] or --verify to read-only compare the store against the seed data.');
  process.exit(0);
}

const publishSecret = process.env.PUBLISH_SECRET;
if (!publishSecret) {
  console.error('[seed-navigation] PUBLISH_SECRET is required with --execute/--verify. Keep it server-side only.');
  process.exit(2);
}

const call = createObjectStoreClient({ baseUrl, publishSecret, agentName: AGENT_NAME });

let failed = false;

// ─── --verify: read-only comparison of store vs seed ─────────────────────────

if (verify) {
  for (const seed of NAVIGATION_SEEDS) {
    const label = `[verify] ${seed.objectId}`;
    const existing = await call({ action: 'get', object_type: 'navigation', object_id: seed.objectId });
    if (existing.status === 404) {
      console.error(`${label}: NOT FOUND — not seeded yet.`);
      failed = true;
      continue;
    }
    if (existing.status !== 200) {
      console.error(`${label}: get failed (${existing.status}): ${JSON.stringify(existing.body)}`);
      failed = true;
      continue;
    }
    const record = existing.body.record ?? {};
    const identical = sameBody(record.body, seed.body);
    const state = `version ${record.version}, content_revision ${record.content_revision}, review ${record.review?.state ?? 'none'}, lock ${record.lock ? 'HELD' : 'free'}`;
    if (identical) {
      console.info(`${label}: body is BYTE-IDENTICAL to the seed (${state}).`);
    } else {
      console.error(`${label}: body DIFFERS from the seed (${state}). Do not approve/publish until reconciled.`);
      console.error(`${label}: stored body follows for inspection:`);
      console.error(JSON.stringify(record.body, null, 2));
      failed = true;
    }
  }
  if (failed) {
    console.error('[verify] MISMATCHES FOUND — see above.');
    process.exit(1);
  }
  console.info('[verify] All drafts match the seed data exactly.');
  process.exit(0);
}

// ─── --execute: create + validate ────────────────────────────────────────────

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
  const outcome = checkValidationAgainstSeed(validated.body.validation, seed.expectedWarningIds);
  if (outcome.ok) {
    console.info(`${label}: ${outcome.note}`);
  } else {
    console.error(`${label}: ${outcome.note}`);
    failed = true;
  }
}

if (failed) {
  console.error('[seed-navigation] FAILED — see above. Nothing was published; drafts may need reconciling.');
  console.error(
    '[seed-navigation] Do NOT run submit-navigation-review until this passes (it re-checks, but fix first).'
  );
  process.exit(1);
}
console.info('[seed-navigation] All three navigation drafts are in place and validate as expected.');
console.info(
  '[seed-navigation] Next: T2.3 — submit for review (scripts/submit-navigation-review.mjs), then the HUMAN-EXECUTED Tier 3 publish.'
);
