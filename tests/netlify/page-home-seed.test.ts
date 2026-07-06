/**
 * T3.4 + T3.5 offline verification — the page_home / sec_newsletter_signup
 * seed data (scripts/lib/page-home-seed-data.mjs):
 *
 *   - both bodies parse under the REAL body schemas (page.v1 / section.v1);
 *   - both requested ids pass the T0.3 validators;
 *   - the seed's section data deep-equals the T3.2 render-gate fixture
 *     (src/lib/registry/components/home-fixture-data.ts) — two files, one
 *     transcription, pinned so they cannot drift (the fixture is what the
 *     components were proven byte-identical against);
 *   - validation with resolvers wired: zero blockers when the shared section
 *     and nav_footer_home resolve; a missing shared section is a blocker;
 *   - the T3.1 `home` PageType constraints hold (hero required, every
 *     section type allowed, shared_ref included).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import { getPageTypeDefinition } from '../../src/lib/registry/page-types.js';
import {
  homeBioData,
  homeChecklistData,
  homeContentGridData,
  homeHeroData,
  homeNewsletterSignupData,
} from '../../src/lib/registry/components/home-fixture-data.js';
import { validateObjectIdForType } from '../../src/lib/object-ids.js';
import { pageBodySchema } from '../../src/schema/bodies/page-v1.js';
import { sectionBodySchema, type SectionInstance } from '../../src/schema/bodies/section-v1.js';
import {
  PAGE_HOME_ID,
  PAGE_HOME_SEEDS,
  SECTION_NEWSLETTER_SIGNUP_ID,
  pageHomeBody,
  sectionNewsletterSignupBody,
} from '../../scripts/lib/page-home-seed-data.mjs';

const sectionData = (id: string) => {
  const section = (pageHomeBody.sections as SectionInstance[]).find((candidate) => candidate.id === id);
  assert.ok(section, `page_home must carry section ${id}`);
  return section.data;
};

test('both seed bodies parse under the real body schemas and ids pass the T0.3 validators', () => {
  const page = pageBodySchema.safeParse(pageHomeBody);
  assert.ok(page.success, JSON.stringify(page.success ? '' : page.error.issues));
  const section = sectionBodySchema.safeParse(sectionNewsletterSignupBody);
  assert.ok(section.success, JSON.stringify(section.success ? '' : section.error.issues));
  assert.ok(validateObjectIdForType('page', PAGE_HOME_ID).ok);
  assert.ok(validateObjectIdForType('section', SECTION_NEWSLETTER_SIGNUP_ID).ok);
  // Seed order is load-bearing: the referenced section is created first.
  assert.deepEqual(
    PAGE_HOME_SEEDS.map((seed) => seed.objectId),
    [SECTION_NEWSLETTER_SIGNUP_ID, PAGE_HOME_ID]
  );
});

test('the seed transcription deep-equals the T3.2 render-gate fixture data (no drift possible)', () => {
  assert.deepEqual(sectionData('s_hero'), homeHeroData);
  assert.deepEqual(sectionData('s_audience'), homeChecklistData);
  assert.deepEqual(sectionData('s_startgrid'), homeContentGridData);
  assert.deepEqual(sectionData('s_bio'), homeBioData);
  assert.deepEqual(sectionNewsletterSignupBody.section.data, homeNewsletterSignupData);
  // The page itself carries only the reference, never a shadow copy (D§3.5).
  assert.deepEqual(sectionData('s_newsletter'), { section: SECTION_NEWSLETTER_SIGNUP_ID });
});

test('page_home validates clean with resolvers wired; a missing shared section is a blocker', () => {
  const home = getPageTypeDefinition('home');
  assert.ok(home.ok);
  const resolvingContext = {
    resolveObject: (objectType: string, objectId: string) => ({
      exists:
        (objectType === 'section' && objectId === SECTION_NEWSLETTER_SIGNUP_ID) ||
        (objectType === 'navigation' && objectId === 'nav_footer_home'),
    }),
    resolveSharedSectionType: (objectId: string) =>
      objectId === SECTION_NEWSLETTER_SIGNUP_ID ? ('newsletter_signup' as const) : undefined,
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

test('the shared section wrapper validates clean as its own object', () => {
  const summary = summarizeValidation(
    validateObject(
      { objectType: 'section', objectId: SECTION_NEWSLETTER_SIGNUP_ID, body: sectionNewsletterSignupBody },
      {}
    )
  );
  assert.deepEqual(summary.blockers, [], JSON.stringify(summary.blockers));
});

test("every page_home section type is allowed by the T3.1 'home' PageType, with the hero requirement met", () => {
  const home = getPageTypeDefinition('home');
  assert.ok(home.ok);
  const allowed = home.definition.allowedSections;
  assert.ok(Array.isArray(allowed));
  const types = (pageHomeBody.sections as SectionInstance[]).map((section) => section.type);
  for (const type of types) {
    assert.ok((allowed as string[]).includes(type), `home PageType must allow '${type}'`);
  }
  for (const required of home.definition.requiredSections ?? []) {
    assert.ok(types.includes(required as SectionInstance['type']), `required section '${required}' present`);
  }
});
