/**
 * Offline verification of the W5 seed (scripts/lib/pages-w5-seed-data.mjs):
 * the last three hand-coded routes (/pricing, /services,
 * /solutions/shop-preview) recomposed as standard page objects served by the
 * object-page catch-all — their route files are deleted in the same change.
 *
 *   - every body parses under page.v1, every id passes the T0.3 validator;
 *   - every page validates clean AT PUBLISH with its PageType wired, the
 *     component registry consulted, AND a reference resolver injected — the
 *     pricing_table tiers must resolve against the S2 mock products for real,
 *     not skip the check;
 *   - the three new W5 section types (steps / content_split / pricing_table)
 *     are registered and actually exercised by the batch;
 *   - routes are unique within the batch and every tier references a product
 *     that exists in the shop seed (one catalog, no ghost tiers).
 */
import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../packages/core/server/lib/object-validate.js';
import { isRegisteredSectionType } from '../../packages/core/lib/registry/components/registered-types.js';
import { getPageTypeDefinition } from '../../packages/core/lib/registry/page-types.js';
import { validateObjectIdForType } from '../../packages/core/lib/object-ids.js';
import { pageBodySchema } from '../../packages/core/schema/bodies/page-v1.js';
import { CONVERSION_SEEDS, SEED_SITE } from '../../sites/drlurie/seeds/pages-w5-seed-data.mjs';
import { CONVERSION_SEEDS as SHOP_SEEDS } from '../../sites/drlurie/seeds/pages-shop-seed-data.mjs';

type Seed = { objectType: 'page' | 'product'; objectId: string; body: Record<string, unknown> };
type SectionInstance = { id: string; type: string; data: Record<string, unknown> };
const batch = CONVERSION_SEEDS as Seed[];
const seeds = batch.filter((seed) => seed.objectType === 'page');

// The S2 mock catalog — the only products the pricing tiers may reference.
const shopProducts = (SHOP_SEEDS as Seed[]).filter((seed) => seed.objectType === 'product');
const shopProductIds = new Set(shopProducts.map((seed) => seed.objectId));

const componentTypeExists = (type: string) => isRegisteredSectionType(type);
const resolveObject = (objectType: string, objectId: string) =>
  objectType === 'product' && shopProductIds.has(objectId) ? { exists: true, published: true } : { exists: false };

const sectionsOf = (seed: Seed) => (seed.body as { sections: SectionInstance[] }).sections;

test('the batch is exactly the three passed-over hand-coded routes, all standard pages', () => {
  assert.equal(SEED_SITE, 'site_drlurie');
  assert.deepEqual(
    seeds.map((seed) => [seed.objectType, seed.objectId, (seed.body as { route: string }).route]),
    [
      ['page', 'page_shop_preview', '/solutions/shop-preview'],
      ['page', 'page_pricing', '/pricing'],
      ['page', 'page_services', '/services'],
    ]
  );
  // The product reference targets are prepended (trap 3: referenced objects
  // before referrers — tier refs block at WRITE) and are the shop module's
  // OWN seed objects, imported not copied — one catalog, no drift.
  for (const [index, product] of shopProducts.entries()) {
    assert.equal(batch[index], product, `${product.objectId} must be the shop module's identical seed`);
  }
  assert.equal(batch.length, shopProducts.length + seeds.length);
  for (const seed of seeds) {
    assert.equal((seed.body as { pageType: string }).pageType, 'standard', seed.objectId);
  }
  const routes = seeds.map((seed) => (seed.body as { route: string }).route);
  assert.equal(new Set(routes).size, routes.length, 'routes must be unique within the batch');
});

test('every body parses under page.v1 and every id passes the T0.3 validator', () => {
  for (const seed of seeds) {
    const parsed = pageBodySchema.safeParse(seed.body);
    assert.ok(parsed.success, `${seed.objectId}: ${JSON.stringify(parsed.success ? '' : parsed.error.issues)}`);
    assert.ok(validateObjectIdForType('page', seed.objectId).ok, `${seed.objectId} invalid id`);
  }
});

test('every page validates clean AT PUBLISH with references resolved for real', () => {
  for (const seed of seeds) {
    const pageType = (seed.body as { pageType: string }).pageType;
    const lookup = getPageTypeDefinition(pageType);
    assert.ok(lookup.ok, `${seed.objectId}: pageType ${pageType} must be defined`);
    const summary = summarizeValidation(
      validateObject(
        { objectType: 'page', objectId: seed.objectId, body: seed.body },
        {
          pageType: lookup.ok ? lookup.definition : undefined,
          componentTypeExists,
          resolveObject: resolveObject as never,
          isRouteTaken: () => false,
          publishIntent: true,
        }
      )
    );
    assert.deepEqual(summary.blockers, [], `${seed.objectId}: ${JSON.stringify(summary.blockers)}`);
  }
});

test('the three new W5 section types are registered AND exercised by the batch', () => {
  const used = new Set(seeds.flatMap((seed) => sectionsOf(seed).map((section) => section.type)));
  for (const type of ['steps', 'content_split', 'pricing_table']) {
    assert.ok(isRegisteredSectionType(type), `${type} must be in the component registry`);
    assert.ok(used.has(type), `${type} must actually appear in a W5 seed`);
  }
  // …and everything else the batch uses is registered too.
  for (const type of used) assert.ok(isRegisteredSectionType(type), `${type} is unregistered`);
});

test('every pricing tier references a product that exists in the shop catalog', () => {
  const pricing = seeds.find((seed) => seed.objectId === 'page_pricing')!;
  const table = sectionsOf(pricing).find((section) => section.type === 'pricing_table');
  assert.ok(table, 'page_pricing needs the pricing_table');
  const tiers = (table.data as { tiers: Array<{ product: string; highlighted?: boolean }> }).tiers;
  assert.equal(tiers.length, 3, 'one tier per mock product');
  for (const tier of tiers) {
    assert.ok(shopProductIds.has(tier.product), `tier product ${tier.product} is not in the shop seed`);
  }
  assert.equal(new Set(tiers.map((tier) => tier.product)).size, tiers.length, 'no duplicate tier products');
  assert.equal(tiers.filter((tier) => tier.highlighted).length, 1, 'exactly one highlighted tier');
});

test('page_shop_preview keeps the real route the nav links to, recomposed as content_split', () => {
  const preview = seeds.find((seed) => seed.objectId === 'page_shop_preview')!;
  const sections = sectionsOf(preview);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].type, 'content_split');
  const data = sections[0].data as { images: unknown[]; actions: Array<{ target: { href: string } }> };
  assert.equal(data.images.length, 2, 'the staggered two-image hero survives the generalization');
  assert.deepEqual(
    data.actions.map((action) => action.target.href),
    ['/solutions/early-access', '/learn/topics']
  );
});
