/**
 * Offline verification of the form-page decomposition seed
 * (scripts/lib/pages-forms-seed-data.mjs): page_contact (lede + contact_form +
 * content_grid cards-with-icons) and page_thank_you (form_confirmation), both
 * `standard` pages composed from reusable generic types — the last two bespoke
 * per-page section types (`contact`, `thank_you`) retired/renamed.
 *
 *   - every page body parses under the real page schema; every id passes T0.3;
 *   - each page validates clean with its PageType constraints wired;
 *   - the decomposition uses only reusable types (no bespoke `contact` /
 *     `thank_you`), and the contact grid carries icons.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import { isRegisteredSectionType } from '../../src/lib/registry/components/registered-types.js';
import { getPageTypeDefinition } from '../../src/lib/registry/page-types.js';
import { validateObjectIdForType } from '../../src/lib/object-ids.js';
import { pageBodySchema } from '../../src/schema/bodies/page-v1.js';
import { CONVERSION_SEEDS, SEED_SITE } from '../../scripts/lib/pages-forms-seed-data.mjs';

type Seed = {
  objectType: string;
  objectId: string;
  body: { pageType: string; sections: Array<{ type: string; data: Record<string, unknown> }> };
};
const seeds = CONVERSION_SEEDS as Seed[];

const componentTypeExists = (type: string) => isRegisteredSectionType(type);

test('the batch is two standard form pages for site_drlurie', () => {
  assert.equal(SEED_SITE, 'site_drlurie');
  assert.deepEqual(
    seeds.map((seed) => [seed.objectType, seed.objectId]),
    [
      ['page', 'page_contact'],
      ['page', 'page_thank_you'],
    ]
  );
  assert.ok(seeds.every((seed) => seed.body.pageType === 'standard'));
});

test('every page body parses under page.v1 and every id passes the T0.3 validator', () => {
  for (const seed of seeds) {
    const parsed = pageBodySchema.safeParse(seed.body);
    assert.ok(parsed.success, `${seed.objectId}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
    assert.ok(validateObjectIdForType('page', seed.objectId).ok, `${seed.objectId} invalid id`);
  }
});

test('every page validates clean with its PageType + component registry wired', () => {
  for (const seed of seeds) {
    const lookup = getPageTypeDefinition(seed.body.pageType);
    assert.ok(lookup.ok, `${seed.objectId}: unknown pageType ${seed.body.pageType}`);
    const summary = summarizeValidation(
      validateObject(
        { objectType: 'page', objectId: seed.objectId, body: seed.body },
        { pageType: lookup.ok ? lookup.definition : undefined, componentTypeExists }
      )
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId}: ${JSON.stringify(summary.blockers)}`);
  }
});

test('the decomposition uses only reusable types — no bespoke contact / thank_you', () => {
  const types = seeds.flatMap((seed) => seed.body.sections.map((section) => section.type));
  assert.ok(!types.includes('contact'), 'the bespoke contact type is retired');
  assert.ok(!types.includes('thank_you'), 'thank_you was renamed to form_confirmation');
  assert.ok(
    types.every((type) => isRegisteredSectionType(type)),
    'every section type is a registered reusable type'
  );
});

test('page_contact composes lede + contact_form + an icon card grid', () => {
  const contact = seeds.find((seed) => seed.objectId === 'page_contact')!;
  assert.deepEqual(
    contact.body.sections.map((section) => section.type),
    ['lede', 'contact_form', 'content_grid']
  );
  const grid = contact.body.sections[2]!.data as { source: { kind: string; cards: Array<{ icon?: string }> } };
  assert.equal(grid.source.kind, 'cards');
  assert.ok(grid.source.cards.length >= 1);
  assert.ok(
    grid.source.cards.every((cell) => typeof cell.icon === 'string'),
    'every "how we can help" cell carries an icon'
  );
});

test('page_thank_you is a single form_confirmation section keyed by ?form=', () => {
  const thanks = seeds.find((seed) => seed.objectId === 'page_thank_you')!;
  assert.deepEqual(
    thanks.body.sections.map((section) => section.type),
    ['form_confirmation']
  );
  const data = thanks.body.sections[0]!.data as { formMessages: Array<{ form: string }> };
  assert.deepEqual(
    data.formMessages.map((entry) => entry.form),
    ['contact', 'free-guide', 'newsletter']
  );
});
