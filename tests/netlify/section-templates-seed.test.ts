/**
 * Offline verification of the starter section-template recipes
 * (scripts/lib/section-templates-seed-data.mjs, W8.1 — 09-template-system-plan
 * §2.6):
 *
 *   - every body parses under section_template.v1; every stpl_* id passes T0.3;
 *   - every recipe validates clean through the full pipeline (the blueprint
 *     placeability check and the real-splitter renderability check are live);
 *   - every blueprint is STAMPABLE: placed as an ordinary inline section on a
 *     `standard` page, the page parses under page.v1 and validates clean under
 *     PageType law — the W8.1-level proof that a stamped section is legal
 *     before the instantiate verb (W8.2) exists;
 *   - every blueprint is self-contained (no shared_ref / object / asset refs),
 *     the templates-seed rule.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import {
  isRegisteredSectionType,
  isStandalonePlaceableSectionType,
} from '../../packages/core/lib/registry/components/registered-types.js';
import { getPageTypeDefinition } from '../../packages/core/lib/registry/page-types.js';
import { validateObjectIdForType } from '../../packages/core/lib/object-ids.js';
import { pageBodySchema } from '../../packages/core/schema/bodies/page-v1.js';
import { sectionTemplateBodySchema, type SectionTemplateBody } from '../../packages/core/schema/bodies/section-template-v1.js';
import { CONVERSION_SEEDS, SEED_SITE } from '../../scripts/lib/section-templates-seed-data.mjs';

type Seed = { objectType: string; objectId: string; body: SectionTemplateBody };
const seeds = CONVERSION_SEEDS as Seed[];

const componentTypeExists = (type: string) => isRegisteredSectionType(type);

test('the batch is five section templates for site_drlurie', () => {
  assert.equal(SEED_SITE, 'site_drlurie');
  assert.deepEqual(
    seeds.map((seed) => [seed.objectType, seed.objectId]),
    [
      ['section_template', 'stpl_hero_landing'],
      ['section_template', 'stpl_audience_grid'],
      ['section_template', 'stpl_related_articles'],
      ['section_template', 'stpl_newsletter_cta'],
      ['section_template', 'stpl_cta_banner'],
      // W10 T10.8 — starters for the ratified mints.
      ['section_template', 'stpl_stats_band'],
      ['section_template', 'stpl_expectations_timeline'],
      ['section_template', 'stpl_comparison_matrix'],
      ['section_template', 'stpl_media_gallery'],
    ]
  );
});

test('every body parses under section_template.v1 and every id passes the T0.3 validator', () => {
  for (const seed of seeds) {
    const parsed = sectionTemplateBodySchema.safeParse(seed.body);
    assert.ok(parsed.success, `${seed.objectId}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
    assert.ok(validateObjectIdForType('section_template', seed.objectId).ok, `${seed.objectId} invalid id`);
  }
});

test('every recipe validates clean AT PUBLISH LEVEL (W8.3b: metadata-complete)', () => {
  for (const seed of seeds) {
    const summary = summarizeValidation(
      validateObject(
        { objectType: 'section_template', objectId: seed.objectId, body: seed.body },
        { publishIntent: true }
      )
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId}: ${JSON.stringify(summary.blockers)}`);
    const body = seed.body as unknown as { description?: string; whenToUse?: string; scope?: string };
    assert.ok(body.description?.trim(), `${seed.objectId} needs a description`);
    assert.ok(body.whenToUse?.trim(), `${seed.objectId} needs whenToUse`);
    assert.ok(body.scope === 'evergreen' || body.scope === 'one_off', `${seed.objectId} needs a scope`);
  }
});

test('every blueprint is standalone-placeable and self-contained', () => {
  for (const seed of seeds) {
    assert.ok(
      isStandalonePlaceableSectionType(seed.body.blueprint.type),
      `${seed.objectId}: blueprint type ${seed.body.blueprint.type} must be component-bound`
    );
    // Self-contained: no reference-shaped payloads anywhere in the blueprint
    // (shared_ref sections, manual content picks, asset refs) — a stamped
    // section must validate with zero external targets.
    const json = JSON.stringify(seed.body.blueprint);
    assert.ok(!json.includes('shared_ref'), `${seed.objectId}: blueprints may not reference shared sections`);
    assert.ok(!json.includes('AssetRef'), `${seed.objectId}: blueprints may not carry asset refs`);
    assert.ok(!json.includes('"kind":"manual"'), `${seed.objectId}: blueprints may not pick specific content items`);
  }
});

test('every blueprint STAMPS into a standard page that parses and validates clean under PageType law', () => {
  const lookup = getPageTypeDefinition('standard');
  assert.ok(lookup.ok, 'standard PageType must be defined');
  for (const seed of seeds) {
    const page = {
      route: `/stamp-probe-${seed.objectId.replace(/_/g, '-')}`,
      pageType: 'standard' as const,
      title: 'Stamp probe',
      seo: { description: 'Probe page for a stamped recipe.' },
      sections: [structuredClone(seed.body.blueprint)],
    };
    assert.ok(pageBodySchema.safeParse(page).success, `${seed.objectId}: stamped page must parse`);
    const summary = summarizeValidation(
      validateObject(
        { objectType: 'page', objectId: 'page_probe', body: page },
        { pageType: lookup.ok ? lookup.definition : undefined, componentTypeExists }
      )
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId}: ${JSON.stringify(summary.blockers)}`);
  }
});
