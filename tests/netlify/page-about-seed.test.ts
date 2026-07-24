/**
 * Offline verification of the /about decomposition seed
 * (scripts/lib/page-about-seed-data.mjs): the bespoke `about` section became
 * eight standalone shared sections of REUSABLE types (bio / prose ×6 /
 * cta_banner), and page_about a `standard` page of eight shared_refs.
 *
 *   - every body parses under the real body schemas; every id passes T0.3;
 *   - the intro bio carries a URL portrait that does NOT trip artifact trust;
 *   - page_about validates clean with resolvers wired; a missing section blocks;
 *   - each shared section validates clean on its own;
 *   - every effective section type is allowed by the `standard` PageType.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import { getPageTypeDefinition } from '../../packages/core/lib/registry/page-types.js';
import { validateObjectIdForType } from '../../packages/core/lib/object-ids.js';
import { pageBodySchema } from '../../packages/core/schema/bodies/page-v1.js';
import { sectionBodySchema, type SectionType } from '../../packages/core/schema/bodies/section-v1.js';
import { CONVERSION_SEEDS, PAGE_ABOUT_ID, pageAboutBody } from '../../scripts/lib/page-about-seed-data.mjs';

const sectionSeeds = CONVERSION_SEEDS.filter((seed) => seed.objectType === 'section');
const sharedTypes = new Map<string, SectionType>(
  sectionSeeds.map((seed) => [seed.objectId, seed.body.section.type as SectionType])
);

test('all eight sections + the page parse under the real schemas and ids pass T0.3', () => {
  assert.equal(sectionSeeds.length, 8);
  for (const seed of sectionSeeds) {
    const parsed = sectionBodySchema.safeParse(seed.body);
    assert.ok(parsed.success, `${seed.objectId}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
    assert.ok(validateObjectIdForType('section', seed.objectId).ok, `${seed.objectId} invalid`);
  }
  assert.ok(pageBodySchema.safeParse(pageAboutBody).success);
  assert.ok(validateObjectIdForType('page', PAGE_ABOUT_ID).ok);
  // Page created last, after every section it references.
  assert.equal(CONVERSION_SEEDS[CONVERSION_SEEDS.length - 1].objectId, PAGE_ABOUT_ID);
});

test('the family is composed only of REUSABLE types (no bespoke about type)', () => {
  const types = [...sharedTypes.values()].sort();
  assert.deepEqual(types, ['bio', 'cta_banner', 'prose', 'prose', 'prose', 'prose', 'prose', 'prose']);
});

test('page_about validates clean with resolvers; a missing section is a blocker', () => {
  const standard = getPageTypeDefinition('standard');
  assert.ok(standard.ok);
  const context = {
    resolveObject: (objectType: string, objectId: string) => ({
      exists: objectType === 'section' && sharedTypes.has(objectId),
    }),
    resolveSharedSectionType: (objectId: string) => sharedTypes.get(objectId),
    pageType: standard.definition,
  };
  const clean = summarizeValidation(
    validateObject({ objectType: 'page', objectId: PAGE_ABOUT_ID, body: pageAboutBody }, context)
  );
  assert.deepEqual(clean.blockers, [], JSON.stringify(clean.blockers));

  const missing = summarizeValidation(
    validateObject(
      { objectType: 'page', objectId: PAGE_ABOUT_ID, body: pageAboutBody },
      { ...context, resolveObject: () => ({ exists: false }) }
    )
  );
  assert.ok(missing.blockers.length > 0, 'unresolvable shared_refs must block');
});

test('each shared section validates clean on its own (portrait URL passes artifact trust)', () => {
  for (const seed of sectionSeeds) {
    const summary = summarizeValidation(
      validateObject({ objectType: 'section', objectId: seed.objectId, body: seed.body }, {})
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId}: ${JSON.stringify(summary.blockers)}`);
  }
});
