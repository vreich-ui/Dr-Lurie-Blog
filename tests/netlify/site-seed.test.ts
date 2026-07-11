/**
 * Offline verification of the site singleton seed
 * (scripts/lib/site-seed-data.mjs) — the W4 conversion's byte-identical
 * transcription of the currently hardcoded site configuration:
 *
 *   - the body parses under site.v1 (strict — a stray key fails); the id
 *     passes T0.3; validation is clean with the defaultNavigation reference
 *     targets resolvable;
 *   - the brand-token color set covers exactly the CustomStyles.astro custom
 *     properties (every `--aw-color-*` in both blocks, dark overrides under
 *     the `dark:` key prefix) so the data-driven render has a value for every
 *     var it emits;
 *   - a missing defaultNavigation target is a real blocker (the reference
 *     check is live for site objects, not decorative).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import { validateObjectIdForType } from '../../src/lib/object-ids.js';
import { siteBodySchema, type SiteBody } from '../../src/schema/bodies/site-v1.js';
import { CONVERSION_SEEDS, SEED_SITE, siteBody } from '../../scripts/lib/site-seed-data.mjs';

const body = siteBody as SiteBody;

const resolveObject = (objectType: string, objectId: string) => ({
  exists: objectType === 'navigation' && ['nav_header', 'nav_footer', 'nav_footer_home'].includes(objectId),
});

test('the batch is the single site_drlurie singleton owning itself', () => {
  assert.equal(SEED_SITE, 'site_drlurie');
  assert.deepEqual(
    (CONVERSION_SEEDS as Array<{ objectType: string; objectId: string }>).map((seed) => [
      seed.objectType,
      seed.objectId,
    ]),
    [['site', 'site_drlurie']]
  );
});

test('the body parses under site.v1 and the id passes T0.3', () => {
  const parsed = siteBodySchema.safeParse(body);
  assert.ok(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues));
  assert.ok(validateObjectIdForType('site', 'site_drlurie').ok);
});

test('the singleton validates clean with the defaultNavigation targets resolvable', () => {
  const summary = summarizeValidation(
    validateObject({ objectType: 'site', objectId: 'site_drlurie', body }, { resolveObject })
  );
  assert.deepEqual(summary.blockers, [], JSON.stringify(summary.blockers));
});

test('a dangling defaultNavigation target is a blocker (reference check is live)', () => {
  const broken = structuredClone(body) as SiteBody;
  broken.defaultNavigation.header = 'nav_missing';
  const summary = summarizeValidation(
    validateObject({ objectType: 'site', objectId: 'site_drlurie', body: broken }, { resolveObject })
  );
  assert.ok(
    summary.blockers.some((blocker) => JSON.stringify(blocker).includes('nav_missing')),
    JSON.stringify(summary.blockers)
  );
});

test('brand tokens cover every CustomStyles custom property, light and dark', () => {
  const colorKeys = Object.keys(body.brandTokens.colors);
  const light = colorKeys.filter((key) => !key.startsWith('dark:'));
  const dark = colorKeys.filter((key) => key.startsWith('dark:')).map((key) => key.slice('dark:'.length));
  assert.deepEqual(
    light.sort(),
    [
      'accent',
      'bg-page',
      'bg-page-dark',
      'bg-surface',
      'gold',
      'primary',
      'secondary',
      'text-default',
      'text-heading',
      'text-muted',
    ],
    'light tokens must cover the :root block'
  );
  assert.deepEqual(
    dark.sort(),
    ['accent', 'bg-page', 'bg-surface', 'gold', 'primary', 'secondary', 'text-default', 'text-heading', 'text-muted'],
    'dark tokens must cover the .dark block (bg-page-dark has no dark override)'
  );
  for (const key of ['sans', 'serif', 'heading'] as const) {
    assert.ok(body.brandTokens.fonts[key].length > 0, `fonts.${key} present`);
  }
});
