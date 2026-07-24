/**
 * Offline verification of the interior + system page batch seed
 * (scripts/lib/pages-interior-seed-data.mjs): 5 `lede` interior pages + 3
 * `system` pages (privacy/terms `prose`, 404 `cta_banner`), each a single-
 * section `standard`/`system` page with no shared_refs.
 *
 *   - every page body parses under the real page schema; every id passes T0.3;
 *   - each page validates clean with resolvers wired (actions resolve; the
 *     system PageType allows prose + cta_banner; standard allows any);
 *   - the batch is all pages (objectType 'page'), site site_drlurie.
 */
import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../packages/core/server/lib/object-validate.js';
import { getPageTypeDefinition } from '../../packages/core/lib/registry/page-types.js';
import { validateObjectIdForType } from '../../packages/core/lib/object-ids.js';
import { pageBodySchema } from '../../packages/core/schema/bodies/page-v1.js';
import { CONVERSION_SEEDS, SEED_SITE } from '../../scripts/lib/pages-interior-seed-data.mjs';

type Seed = { objectType: string; objectId: string; body: { pageType: string } };
const seeds = CONVERSION_SEEDS as Seed[];

test('the batch is eight standard/system pages for site_drlurie', () => {
  assert.equal(SEED_SITE, 'site_drlurie');
  assert.equal(seeds.length, 8);
  assert.ok(seeds.every((seed) => seed.objectType === 'page'));
  const byType = seeds.map((seed) => seed.body.pageType).sort();
  assert.deepEqual(byType, ['standard', 'standard', 'standard', 'standard', 'standard', 'system', 'system', 'system']);
});

test('every page body parses under page.v1 and every id passes the T0.3 validator', () => {
  for (const seed of seeds) {
    const parsed = pageBodySchema.safeParse(seed.body);
    assert.ok(parsed.success, `${seed.objectId}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
    assert.ok(validateObjectIdForType('page', seed.objectId).ok, `${seed.objectId} invalid id`);
  }
});

test('every page validates clean with its PageType constraints wired', () => {
  for (const seed of seeds) {
    const lookup = getPageTypeDefinition(seed.body.pageType);
    assert.ok(lookup.ok, `${seed.objectId}: unknown pageType ${seed.body.pageType}`);
    const summary = summarizeValidation(
      validateObject(
        { objectType: 'page', objectId: seed.objectId, body: seed.body },
        { pageType: lookup.ok ? lookup.definition : undefined }
      )
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId}: ${JSON.stringify(summary.blockers)}`);
  }
});
