/**
 * The combined "pending conversions" seed module
 * (scripts/lib/pending-conversion-seeds.mjs) aggregates every family still
 * awaiting its credentialed production run into one list, so the whole backlog
 * converts in a single driver run. This pins that it is the exact union of its
 * three source families (nothing dropped, nothing duplicated) and that every
 * object is a driver-supported type.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CONVERSION_SEEDS as INTERIOR } from '../../scripts/lib/pages-interior-seed-data.mjs';
import { CONVERSION_SEEDS as TEMPLATES } from '../../scripts/lib/templates-seed-data.mjs';
import { CONVERSION_SEEDS as FORMS } from '../../scripts/lib/pages-forms-seed-data.mjs';
import { CONVERSION_SEEDS, SEED_SITE } from '../../scripts/lib/pending-conversion-seeds.mjs';

type Seed = { objectType: string; objectId: string };
const seeds = CONVERSION_SEEDS as Seed[];

test('aggregates all three pending families in order, nothing dropped or duplicated', () => {
  const expected = [...INTERIOR, ...TEMPLATES, ...FORMS] as Seed[];
  assert.equal(seeds.length, expected.length);
  assert.deepEqual(
    seeds.map((seed) => seed.objectId),
    expected.map((seed) => seed.objectId)
  );
  assert.equal(new Set(seeds.map((seed) => seed.objectId)).size, seeds.length, 'ids are unique across families');
});

test('every object is a driver-supported type and SEED_SITE is site_drlurie', () => {
  assert.equal(SEED_SITE, 'site_drlurie');
  const supported = new Set(['page', 'section', 'template']);
  assert.ok(
    seeds.every((seed) => supported.has(seed.objectType)),
    'only page/section/template are drilled'
  );
});
