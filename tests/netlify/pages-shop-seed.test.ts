/**
 * Offline verification of the S2 shop seed
 * (scripts/lib/pages-shop-seed-data.mjs): three MOCK products covering all
 * three commerce modes + `page_shop` (standard, query product grid) +
 * `page_product_detail` (content_detail SEO defaults for /shop/[slug]).
 *
 *   - every product body parses under product.v1, every page under page.v1;
 *     every id passes the T0.3 validator;
 *   - every object validates clean AT PUBLISH (the fixed product proves the
 *     stripe_test mirror satisfies the linkage gate; the free product proves
 *     provider 'none' coherence; the PWYW tip proves the no-Price rule);
 *   - the drill dispatch produces a legal set_product_fields round-trip for
 *     products (never touching the §3 price funnel keys);
 *   - page_product_detail declares its PageType-legal drillProbe.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import { isRegisteredSectionType } from '../../src/lib/registry/components/registered-types.js';
import { getPageTypeDefinition } from '../../src/lib/registry/page-types.js';
import { validateObjectIdForType } from '../../src/lib/object-ids.js';
import { pageBodySchema } from '../../src/schema/bodies/page-v1.js';
import { productBodySchema, type ProductBody } from '../../src/schema/bodies/product-v1.js';
import { CONVERSION_SEEDS, SEED_SITE } from '../../scripts/lib/pages-shop-seed-data.mjs';
import { drillOpsForSeed } from '../../scripts/lib/roundtrip-drill.mjs';

type Seed = {
  objectType: 'product' | 'page';
  objectId: string;
  body: Record<string, unknown>;
  drillProbe?: { type: string; data: Record<string, unknown> };
};
const seeds = CONVERSION_SEEDS as Seed[];
const products = seeds.filter((seed) => seed.objectType === 'product');
const pages = seeds.filter((seed) => seed.objectType === 'page');

const componentTypeExists = (type: string) => isRegisteredSectionType(type);

test('the batch is three mock products (one per commerce mode) + the two shop pages', () => {
  assert.equal(SEED_SITE, 'site_drlurie');
  assert.deepEqual(
    seeds.map((seed) => [seed.objectType, seed.objectId]),
    [
      ['product', 'prod_barrier_repair_guide'],
      ['product', 'prod_starter_checklist'],
      ['product', 'prod_support_the_work'],
      ['page', 'page_shop'],
      ['page', 'page_product_detail'],
    ]
  );
  assert.deepEqual(
    products.map((seed) => (seed.body as unknown as ProductBody).commerce.mode).sort(),
    ['fixed', 'free', 'pwyw'],
    'the mock catalog exercises every price badge'
  );
});

test('every body parses under its schema and every id passes the T0.3 validator', () => {
  for (const seed of products) {
    const parsed = productBodySchema.safeParse(seed.body);
    assert.ok(parsed.success, `${seed.objectId}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
    assert.ok(validateObjectIdForType('product', seed.objectId).ok, `${seed.objectId} invalid id`);
  }
  for (const seed of pages) {
    const parsed = pageBodySchema.safeParse(seed.body);
    assert.ok(parsed.success, `${seed.objectId}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
    assert.ok(validateObjectIdForType('page', seed.objectId).ok, `${seed.objectId} invalid id`);
  }
});

test('every product validates clean AT PUBLISH (slug + coherence + linkage gates wired)', () => {
  for (const seed of products) {
    const summary = summarizeValidation(
      validateObject(
        { objectType: 'product', objectId: seed.objectId, body: seed.body },
        { isSlugTaken: () => false, publishIntent: true }
      )
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId}: ${JSON.stringify(summary.blockers)}`);
  }
  // Slug uniqueness across the batch itself.
  const slugs = products.map((seed) => (seed.body as unknown as ProductBody).slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test('both shop pages validate clean AT PUBLISH with their PageType wired', () => {
  for (const seed of pages) {
    const pageType = (seed.body as { pageType: string }).pageType;
    const lookup = getPageTypeDefinition(pageType);
    assert.ok(lookup.ok, `${seed.objectId}: pageType ${pageType} must be defined`);
    const summary = summarizeValidation(
      validateObject(
        { objectType: 'page', objectId: seed.objectId, body: seed.body },
        { pageType: lookup.ok ? lookup.definition : undefined, componentTypeExists, publishIntent: true }
      )
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId}: ${JSON.stringify(summary.blockers)}`);
  }
});

test('page_shop is catch-all-served (standard) with a query product grid — new products appear with no edit', () => {
  const shop = pages.find((seed) => seed.objectId === 'page_shop')!;
  const body = shop.body as { pageType: string; route: string; sections: Array<{ type: string; data: never }> };
  assert.equal(body.pageType, 'standard');
  assert.equal(body.route, '/shop');
  const grid = body.sections.find((section) => section.type === 'product_preview') as
    | { type: string; data: { source: { kind: string } } }
    | undefined;
  assert.ok(grid, 'page_shop needs the product grid');
  assert.equal(grid.data.source.kind, 'query');
});

test('the product drill exercises both ops where coherent and always restores byte-identical', () => {
  for (const seed of products) {
    const body = seed.body as unknown as ProductBody;
    const drill = drillOpsForSeed(seed) as {
      expected: string[];
      ops: Array<{ op: string; fields: Record<string, unknown> }>;
    };
    if (body.commerce.mode === 'fixed') {
      // Fixed products also drill the §3 writer: cache poked one cent, then
      // cache + linkage restored exactly. (+3 T13.10 set_tracking drill ops.)
      assert.deepEqual(drill.expected, ['set_product_fields', 'set_product_price', 'set_tracking'], seed.objectId);
      assert.equal(drill.ops.length, 7);
      assert.deepEqual(drill.ops[3].fields, {
        commerce: { price: body.commerce.price, stripe_test: body.commerce.stripe_test },
      });
    } else {
      // pwyw/free products cannot legally carry a price — fields op only;
      // the driver unions exercised ops across the family for the contract check.
      assert.deepEqual(drill.expected, ['set_product_fields', 'set_tracking'], seed.objectId);
      assert.equal(drill.ops.length, 5);
    }
    for (const op of drill.ops) {
      if (op.op === 'set_product_fields') {
        assert.equal('commerce' in op.fields, false, 'set_product_fields never patches commerce (funnel safety)');
      }
    }
    assert.deepEqual(drill.ops[1].fields, { presentation: { title: body.presentation.title } });
  }
});

test('page_product_detail declares a PageType-legal drillProbe (section-less, like page_article)', () => {
  const detailPage = pages.find((seed) => seed.objectId === 'page_product_detail')!;
  assert.deepEqual((detailPage.body as { sections: unknown[] }).sections, []);
  assert.ok(detailPage.drillProbe, 'page_product_detail needs a drillProbe');
  const detail = getPageTypeDefinition('content_detail');
  assert.ok(detail.ok);
  assert.ok(
    (detail.definition.allowedSections as string[]).includes(detailPage.drillProbe!.type),
    'the probe type must be allowed on content_detail'
  );
  assert.ok(isRegisteredSectionType(detailPage.drillProbe!.type));
});
