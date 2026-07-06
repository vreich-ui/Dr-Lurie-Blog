#!/usr/bin/env node
/**
 * T3.4 + T3.5 — seed the first Page-object migration drafts into the
 * site-objects store: `sec_newsletter_signup` (shared section, Tier 2) and
 * `page_home` (the C§1.1 homepage record), in that order — the page
 * references the section.
 *
 * Bodies live in scripts/lib/page-home-seed-data.mjs; offline verification
 * (schema parses, fixture-data drift pin, validation with resolvers, T3.1
 * PageType constraints) lives in tests/netlify/page-home-seed.test.ts.
 *
 * Usage:
 *   node scripts/seed-page-home.mjs                # dry run: print payloads
 *   node scripts/seed-page-home.mjs --execute      # create + validate
 *   node scripts/seed-page-home.mjs --verify       # READ-ONLY store-vs-seed compare
 *
 * Env (for --execute/--verify): PUBLISH_SECRET, OBJECT_STORE_BASE_URL
 * (default http://localhost:8888).
 *
 * SCHEMA-VINTAGE GATE (the T2.2 lesson, stronger this time): these bodies
 * use Phase 3 schema amendments — M-9 fields (kicker/anchor/disclaimer/grid
 * intro) and the M-8 grammar. The DEPLOYED create verb validates against the
 * schema code live on main. If --execute reports a schema rejection naming
 * an unrecognized key on those fields, the Phase 3 branch has not merged and
 * deployed yet — deploy first; do not "fix" the seed data to match the old
 * schema.
 *
 * Idempotent like seed-navigation.mjs: 409 + byte-identical body → OK;
 * 409 + drifted body → loud refusal (someone edited the draft; reconcile by
 * hand or with patch ops, never by re-seeding).
 *
 * Seeding creates DRAFTS only. page/section are Tier 2: publish is
 * agent-executable but ONLY after human approval pinned to the reviewed
 * content_revision (+ M-6 publish action) — that step is T3.4/T3.6's flow,
 * not this script's. Nothing on the live site changes here.
 */
import { PAGE_HOME_SEEDS, PAGE_HOME_SEED_SITE } from './lib/page-home-seed-data.mjs';
import { createObjectStoreClient, sameBody, blockerMessages, warningIds } from './lib/object-store-client.mjs';

const AGENT_NAME = 'phase-3-page-home-seed';

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const verify = args.has('--verify');
const baseUrl = process.env.OBJECT_STORE_BASE_URL || 'http://localhost:8888';

if (!execute && !verify) {
  console.info('[seed-page-home] Dry run. Records that --execute would create (in order):');
  for (const seed of PAGE_HOME_SEEDS) {
    console.info(`\n─── ${seed.objectId} (${seed.objectType}) ` + '─'.repeat(Math.max(0, 48 - seed.objectId.length)));
    console.log(
      JSON.stringify(
        {
          action: 'create',
          object_type: seed.objectType,
          site: PAGE_HOME_SEED_SITE,
          requested_id: seed.objectId,
          body: seed.body,
        },
        null,
        2
      )
    );
  }
  console.info('\n[seed-page-home] Re-run with --execute (PUBLISH_SECRET + OBJECT_STORE_BASE_URL set) to create,');
  console.info('[seed-page-home] or --verify to read-only compare the store against the seed data.');
  process.exit(0);
}

const publishSecret = process.env.PUBLISH_SECRET;
if (!publishSecret) {
  console.error('[seed-page-home] PUBLISH_SECRET is required with --execute/--verify. Keep it server-side only.');
  process.exit(2);
}

const call = createObjectStoreClient({ baseUrl, publishSecret, agentName: AGENT_NAME });

let failed = false;

// ─── --verify: read-only comparison of store vs seed ─────────────────────────

if (verify) {
  for (const seed of PAGE_HOME_SEEDS) {
    const label = `[verify] ${seed.objectId}`;
    const existing = await call({ action: 'get', object_type: seed.objectType, object_id: seed.objectId });
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
  console.info('[verify] Both drafts match the seed data exactly.');
  process.exit(0);
}

// ─── --execute: create + validate, section before page ───────────────────────

for (const seed of PAGE_HOME_SEEDS) {
  const label = `[seed-page-home] ${seed.objectId}`;

  const created = await call({
    action: 'create',
    object_type: seed.objectType,
    site: PAGE_HOME_SEED_SITE,
    requested_id: seed.objectId,
    body: seed.body,
  });

  if (created.status === 200) {
    console.info(`${label}: created (version ${created.body.record?.version}).`);
  } else if (created.status === 409) {
    const existing = await call({ action: 'get', object_type: seed.objectType, object_id: seed.objectId });
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
    console.error(
      `${label}: if the failure names an unrecognized field (kicker/anchor/disclaimer/body on a grid, or ` +
        'fallback), the deployed schema predates Phase 3 (M-8/M-9) — merge + deploy the Phase 3 branch first; do NOT trim the seed.'
    );
    failed = true;
    continue;
  }

  const validated = await call({ action: 'validate', object_type: seed.objectType, object_id: seed.objectId });
  if (validated.status !== 200) {
    console.error(`${label}: validate failed (${validated.status}):`, JSON.stringify(validated.body, null, 2));
    failed = true;
    continue;
  }
  const blockers = blockerMessages(validated.body.validation);
  const warnings = warningIds(validated.body.validation);
  if (blockers.length > 0) {
    console.error(`${label}: validation BLOCKERS — ${blockers.join(' | ')}`);
    failed = true;
    continue;
  }
  console.info(
    `${label}: zero blockers${warnings.length ? `; warnings: ${warnings.join(', ')} (inspect before review)` : '; zero warnings'}.`
  );
}

if (failed) {
  console.error('[seed-page-home] FAILED — see above. Drafts may need reconciling; nothing was published.');
  process.exit(1);
}
console.info('[seed-page-home] Both drafts are in place and validate clean.');
console.info(
  '[seed-page-home] Next: Tier 2 review + approval for sec_newsletter_signup and page_home (T3.4/T3.6 flow); the homepage cutover itself waits on T3.6.'
);
