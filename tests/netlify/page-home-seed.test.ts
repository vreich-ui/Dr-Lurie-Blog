/**
 * Offline verification of the home-page object-family seed data
 * (scripts/lib/page-home-seed-data.mjs):
 *
 *   - all four bodies parse under the REAL body schemas (page.v1 / section.v1);
 *   - all requested ids pass the T0.3 validators;
 *   - the seed's section data deep-equals the render-gate fixture
 *     (src/lib/registry/components/home-fixture-data.ts) — two files, one
 *     transcription, pinned so they cannot drift (the fixture is what the
 *     components were proven against);
 *   - validation with resolvers wired: zero blockers when the three shared
 *     sections and nav_footer_home resolve; a missing shared section is a
 *     blocker;
 *   - the T3.1 `home` PageType constraints hold (hero required, every
 *     section type allowed — shared_ref targets counted by effective type).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import { getPageTypeDefinition } from '../../packages/core/lib/registry/page-types.js';
import {
  homeAudienceGridData,
  homeBioData,
  homeHeroData,
  homeNewsletterSignupData,
  homeStartGridData,
} from '../../packages/core/lib/registry/components/home-fixture-data.js';
import { validateObjectIdForType } from '../../packages/core/lib/object-ids.js';
import { pageBodySchema } from '../../packages/core/schema/bodies/page-v1.js';
import { sectionBodySchema, type SectionInstance, type SectionType } from '../../packages/core/schema/bodies/section-v1.js';
import {
  PAGE_HOME_ID,
  PAGE_HOME_SEEDS,
  SECTION_HOME_AUDIENCE_GRID_ID,
  SECTION_HOME_START_GRID_ID,
  SECTION_NEWSLETTER_SIGNUP_ID,
  pageHomeBody,
  sectionHomeAudienceGridBody,
  sectionHomeStartGridBody,
  sectionNewsletterSignupBody,
} from '../../scripts/lib/page-home-seed-data.mjs';

const SECTION_SEEDS = [
  { id: SECTION_NEWSLETTER_SIGNUP_ID, body: sectionNewsletterSignupBody, type: 'newsletter_signup' as const },
  { id: SECTION_HOME_AUDIENCE_GRID_ID, body: sectionHomeAudienceGridBody, type: 'content_grid' as const },
  { id: SECTION_HOME_START_GRID_ID, body: sectionHomeStartGridBody, type: 'content_grid' as const },
];

const sectionData = (id: string) => {
  const section = (pageHomeBody.sections as SectionInstance[]).find((candidate) => candidate.id === id);
  assert.ok(section, `page_home must carry section ${id}`);
  return section.data;
};

test('all seed bodies parse under the real body schemas and ids pass the T0.3 validators', () => {
  const page = pageBodySchema.safeParse(pageHomeBody);
  assert.ok(page.success, JSON.stringify(page.success ? '' : page.error.issues));
  for (const seed of SECTION_SEEDS) {
    const parsed = sectionBodySchema.safeParse(seed.body);
    assert.ok(parsed.success, `${seed.id}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
    assert.ok(validateObjectIdForType('section', seed.id).ok);
  }
  assert.ok(validateObjectIdForType('page', PAGE_HOME_ID).ok);
  // Seed order is load-bearing: every referenced section is created first.
  assert.deepEqual(
    PAGE_HOME_SEEDS.map((seed) => seed.objectId),
    [SECTION_NEWSLETTER_SIGNUP_ID, SECTION_HOME_AUDIENCE_GRID_ID, SECTION_HOME_START_GRID_ID, PAGE_HOME_ID]
  );
});

test('the seed transcription deep-equals the render-gate fixture data (no drift possible)', () => {
  assert.deepEqual(sectionData('s_hero'), homeHeroData);
  assert.deepEqual(sectionData('s_bio'), homeBioData);
  assert.deepEqual(sectionNewsletterSignupBody.section.data, homeNewsletterSignupData);
  assert.deepEqual(sectionHomeAudienceGridBody.section.data, homeAudienceGridData);
  assert.deepEqual(sectionHomeStartGridBody.section.data, homeStartGridData);
  // The page itself carries only references, never shadow copies (D§3.5).
  assert.deepEqual(sectionData('s_audience'), { section: SECTION_HOME_AUDIENCE_GRID_ID });
  assert.deepEqual(sectionData('s_startgrid'), { section: SECTION_HOME_START_GRID_ID });
  assert.deepEqual(sectionData('s_newsletter'), { section: SECTION_NEWSLETTER_SIGNUP_ID });
});

test('both grids are instances of the ONE reusable content_grid type (design-principles litmus)', () => {
  assert.equal(sectionHomeAudienceGridBody.section.type, 'content_grid');
  assert.equal(sectionHomeStartGridBody.section.type, 'content_grid');
  // Different roles from configuration alone — no code change between them.
  assert.equal((sectionHomeAudienceGridBody.section.data as { source: { kind: string } }).source.kind, 'cards');
  assert.equal((sectionHomeStartGridBody.section.data as { source: { kind: string } }).source.kind, 'query');
});

test('page_home validates clean with resolvers wired; a missing shared section is a blocker', () => {
  const home = getPageTypeDefinition('home');
  assert.ok(home.ok);
  const sharedTypes = new Map<string, SectionType>(SECTION_SEEDS.map((seed) => [seed.id, seed.type]));
  const resolvingContext = {
    resolveObject: (objectType: string, objectId: string) => ({
      exists:
        (objectType === 'section' && sharedTypes.has(objectId)) ||
        (objectType === 'navigation' && objectId === 'nav_footer_home'),
    }),
    resolveSharedSectionType: (objectId: string) => sharedTypes.get(objectId),
    pageType: home.definition,
  };

  const clean = summarizeValidation(
    validateObject({ objectType: 'page', objectId: PAGE_HOME_ID, body: pageHomeBody }, resolvingContext)
  );
  assert.deepEqual(clean.blockers, [], JSON.stringify(clean.blockers));

  const missingSection = summarizeValidation(
    validateObject(
      { objectType: 'page', objectId: PAGE_HOME_ID, body: pageHomeBody },
      { ...resolvingContext, resolveObject: () => ({ exists: false }) }
    )
  );
  assert.ok(missingSection.blockers.length > 0, 'unresolvable references must block');
});

test('every shared-section wrapper validates clean as its own object', () => {
  for (const seed of SECTION_SEEDS) {
    const summary = summarizeValidation(
      validateObject({ objectType: 'section', objectId: seed.id, body: seed.body }, {})
    );
    assert.deepEqual(summary.blockers, [], `${seed.id}: ${JSON.stringify(summary.blockers)}`);
  }
});

test("every page_home section type is allowed by the T3.1 'home' PageType, with the hero requirement met", () => {
  const home = getPageTypeDefinition('home');
  assert.ok(home.ok);
  const allowed = home.definition.allowedSections;
  assert.ok(Array.isArray(allowed));
  const sharedTypes = new Map<string, SectionType>(SECTION_SEEDS.map((seed) => [seed.id, seed.type]));
  // Effective types: a shared_ref counts as its target's type for the allowlist.
  const types = (pageHomeBody.sections as SectionInstance[]).map((section) =>
    section.type === 'shared_ref' ? sharedTypes.get((section.data as { section: string }).section) : section.type
  );
  for (const type of types) {
    assert.ok(type, 'every shared_ref target must resolve to a seeded section');
    assert.ok((allowed as string[]).includes(type), `home PageType must allow '${type}'`);
  }
  for (const required of home.definition.requiredSections ?? []) {
    assert.ok(types.includes(required as SectionInstance['type']), `required section '${required}' present`);
  }
});
