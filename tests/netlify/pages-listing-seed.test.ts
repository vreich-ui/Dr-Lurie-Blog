/**
 * Offline verification of the W6 listing-surface seed
 * (scripts/lib/pages-listing-seed-data.mjs): five `listing` pages (library,
 * topics index/detail, category, tag) + `page_article` (`content_detail`) —
 * the T6.1 batch that makes listing headings/SEO agent-editable while the
 * query machinery stays the audited build-time derivation.
 *
 *   - every page body parses under the real page schema; every id passes T0.3;
 *   - each page validates clean AT PUBLISH with its PageType constraints wired
 *     (page_article proves the content_detail zero-section exemption);
 *   - every listing page's first section is the required `lede` header block;
 *   - per-term surfaces carry the `%term%` pattern token where the loaders
 *     interpolate it; routes are unique family patterns;
 *   - page_article declares a PageType-legal drillProbe (the section-less
 *     page's round-trip probe source).
 */
import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../packages/core/server/lib/object-validate.js';
import { isRegisteredSectionType } from '../../packages/core/lib/registry/components/registered-types.js';
import { getPageTypeDefinition } from '../../packages/core/lib/registry/page-types.js';
import { applyListingTerm } from '../../packages/core/lib/renderer/listing-term.js';
import { validateObjectIdForType } from '../../packages/core/lib/object-ids.js';
import { pageBodySchema } from '../../packages/core/schema/bodies/page-v1.js';
import { CONVERSION_SEEDS, SEED_SITE } from '../../sites/drlurie/seeds/pages-listing-seed-data.mjs';

type Seed = {
  objectType: string;
  objectId: string;
  body: {
    pageType: string;
    route: string;
    title: string;
    seo: Record<string, unknown>;
    sections: Array<{ id: string; type: string; data: Record<string, unknown> }>;
  };
  drillProbe?: { type: string; data: Record<string, unknown> };
};
const seeds = CONVERSION_SEEDS as Seed[];

const componentTypeExists = (type: string) => isRegisteredSectionType(type);

test('the batch is the six T6.1 objects for site_drlurie', () => {
  assert.equal(SEED_SITE, 'site_drlurie');
  assert.deepEqual(
    seeds.map((seed) => [seed.objectType, seed.objectId, seed.body.pageType]),
    [
      ['page', 'page_library', 'listing'],
      ['page', 'page_topics_index', 'listing'],
      ['page', 'page_topic_detail', 'listing'],
      ['page', 'page_category', 'listing'],
      ['page', 'page_tag', 'listing'],
      ['page', 'page_article', 'content_detail'],
    ]
  );
});

test('every page body parses under page.v1 and every id passes the T0.3 validator', () => {
  for (const seed of seeds) {
    const parsed = pageBodySchema.safeParse(seed.body);
    assert.ok(parsed.success, `${seed.objectId}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
    assert.ok(validateObjectIdForType('page', seed.objectId).ok, `${seed.objectId} invalid id`);
  }
});

test('every page validates clean AT PUBLISH with its PageType wired (zero-section content_detail included)', () => {
  for (const seed of seeds) {
    const lookup = getPageTypeDefinition(seed.body.pageType);
    assert.ok(lookup.ok, `${seed.objectId}: pageType ${seed.body.pageType} must be defined (W6)`);
    const summary = summarizeValidation(
      validateObject(
        { objectType: 'page', objectId: seed.objectId, body: seed.body },
        { pageType: lookup.ok ? lookup.definition : undefined, componentTypeExists, publishIntent: true }
      )
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId}: ${JSON.stringify(summary.blockers)}`);
  }
});

test('every listing page opens with its required lede header block; page_article has zero sections', () => {
  for (const seed of seeds) {
    if (seed.body.pageType === 'listing') {
      assert.equal(seed.body.sections[0]?.type, 'lede', `${seed.objectId} must open with the lede header`);
    }
  }
  const article = seeds.find((seed) => seed.objectId === 'page_article')!;
  assert.deepEqual(article.body.sections, []);
});

test('per-term surfaces carry %term% pattern copy and it interpolates cleanly', () => {
  const perTerm = ['page_topic_detail', 'page_category', 'page_tag'];
  for (const objectId of perTerm) {
    const seed = seeds.find((candidate) => candidate.objectId === objectId)!;
    const flat = JSON.stringify(seed.body);
    assert.ok(flat.includes('%term%'), `${objectId} must carry the %term% token`);
    const interpolated = applyListingTerm(seed.body, 'Skin Health');
    assert.ok(!JSON.stringify(interpolated).includes('%term%'), `${objectId}: every token interpolates`);
  }
  // The single-route surfaces carry NO token — nothing would interpolate it.
  for (const objectId of ['page_library', 'page_topics_index', 'page_article']) {
    const seed = seeds.find((candidate) => candidate.objectId === objectId)!;
    assert.ok(!JSON.stringify(seed.body).includes('%term%'), `${objectId} must not carry %term%`);
  }
});

test('routes are unique self-describing family patterns', () => {
  const routes = seeds.map((seed) => seed.body.route);
  assert.equal(new Set(routes).size, routes.length, 'routes must be unique');
  assert.ok(routes.every((route) => route.startsWith('/')));
});

test('page_article declares a PageType-legal drillProbe (section-less pages cannot clone one)', () => {
  const article = seeds.find((seed) => seed.objectId === 'page_article')!;
  assert.ok(article.drillProbe, 'page_article needs a drillProbe');
  const detail = getPageTypeDefinition('content_detail');
  assert.ok(detail.ok);
  assert.ok(
    (detail.definition.allowedSections as string[]).includes(article.drillProbe!.type),
    'the probe type must be allowed on content_detail'
  );
  assert.ok(isRegisteredSectionType(article.drillProbe!.type));
});
