/**
 * Offline verification of the starter template recipes
 * (scripts/lib/templates-seed-data.mjs): tpl_interior + tpl_landing
 * (standard) and tpl_legal (system, blueprint-less required slot).
 *
 *   - every template body parses under template.v1; every id passes T0.3;
 *   - each template validates clean with the component registry wired
 *     (template_blueprints / template_registry are live checks);
 *   - each recipe INSTANTIATES: buildPageBodyFromTemplate produces a page
 *     that parses under page.v1 and validates clean under its PageType —
 *     including tpl_legal's registry-defaultData fallback path.
 */
import '../../src/config/policy-bindings.js'; // W11 T11.2
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../packages/core/server/lib/object-validate.js';
import { isRegisteredSectionType } from '../../packages/core/lib/registry/components/registered-types.js';
import { getPageTypeDefinition } from '../../packages/core/lib/registry/page-types.js';
import { validateObjectIdForType } from '../../packages/core/lib/object-ids.js';
import { buildPageBodyFromTemplate } from '../../packages/core/lib/template-instantiate.js';
import { pageBodySchema, type PageTypeId } from '../../packages/core/schema/bodies/page-v1.js';
import { templateBodySchema, type TemplateBody } from '../../packages/core/schema/bodies/template-v1.js';
import { CONVERSION_SEEDS, SEED_SITE } from '../../sites/drlurie/seeds/templates-seed-data.mjs';

type Seed = { objectType: string; objectId: string; body: TemplateBody };
const seeds = CONVERSION_SEEDS as Seed[];

const componentTypeExists = (type: string) => isRegisteredSectionType(type);

test('the batch is three templates for site_drlurie', () => {
  assert.equal(SEED_SITE, 'site_drlurie');
  assert.deepEqual(
    seeds.map((seed) => [seed.objectType, seed.objectId]),
    [
      ['template', 'tpl_interior'],
      ['template', 'tpl_landing'],
      ['template', 'tpl_legal'],
    ]
  );
});

test('every template body parses under template.v1 and every id passes the T0.3 validator', () => {
  for (const seed of seeds) {
    const parsed = templateBodySchema.safeParse(seed.body);
    assert.ok(parsed.success, `${seed.objectId}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
    assert.ok(validateObjectIdForType('template', seed.objectId).ok, `${seed.objectId} invalid id`);
  }
});

test('every template validates clean AT PUBLISH LEVEL with the component registry wired (W8.3b: metadata-complete)', () => {
  for (const seed of seeds) {
    const summary = summarizeValidation(
      validateObject(
        { objectType: 'template', objectId: seed.objectId, body: seed.body },
        { componentTypeExists, publishIntent: true }
      )
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId}: ${JSON.stringify(summary.blockers)}`);
    // The reuse-first index fields every seed must author (recipe_metadata).
    const body = seed.body as unknown as { description?: string; whenToUse?: string; scope?: string };
    assert.ok(body.description?.trim(), `${seed.objectId} needs a description`);
    assert.ok(body.whenToUse?.trim(), `${seed.objectId} needs whenToUse`);
    assert.ok(body.scope === 'evergreen' || body.scope === 'one_off', `${seed.objectId} needs a scope`);
  }
});

test('every recipe instantiates into a page that parses and validates clean under its PageType', () => {
  for (const seed of seeds) {
    const built = buildPageBodyFromTemplate(seed.body, {
      route: `/instantiate-probe-${seed.objectId}`,
      title: 'Instantiate probe',
      templateRef: seed.objectId,
      instantiatedAt: '2026-07-11T00:00:00.000Z',
    });
    assert.ok(built.ok, `${seed.objectId}: ${built.ok ? '' : built.error}`);
    assert.ok(pageBodySchema.safeParse(built.body).success, `${seed.objectId}: instantiated body must parse`);

    const lookup = getPageTypeDefinition(built.body.pageType);
    assert.ok(lookup.ok, `${seed.objectId}: unknown pageType ${built.body.pageType}`);
    const summary = summarizeValidation(
      validateObject(
        { objectType: 'page', objectId: 'page_probe', body: built.body },
        { pageType: lookup.ok ? lookup.definition : undefined, componentTypeExists }
      )
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId}: ${JSON.stringify(summary.blockers)}`);

    // Every REQUIRED slot produced a section (blueprint or defaultData fallback).
    const required = seed.body.slots.filter((slot) => slot.required).length;
    assert.ok(built.body.sections.length >= required, `${seed.objectId}: required slots must all be filled`);
  }
});

test("tpl_legal's blueprint-less required slot instantiates from the prose registry defaultData", () => {
  const legal = seeds.find((seed) => seed.objectId === 'tpl_legal')!;
  assert.equal(legal.body.slots[0]!.blueprint, undefined, 'the fallback path must stay exercised');
  const built = buildPageBodyFromTemplate(legal.body, {
    route: '/instantiate-probe-legal',
    title: 'Legal probe',
    templateRef: 'tpl_legal',
    instantiatedAt: '2026-07-11T00:00:00.000Z',
  });
  assert.ok(built.ok, built.ok ? '' : built.error);
  assert.equal(built.body.pageType, 'system' satisfies PageTypeId);
  assert.equal(built.body.sections.length, 1);
  assert.equal(built.body.sections[0]!.type, 'prose');
  assert.deepEqual(built.body.sections[0]!.data, { body: '<p></p>' });
});
