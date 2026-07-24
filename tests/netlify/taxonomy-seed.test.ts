/**
 * Offline verification of the curated taxonomy registry seed
 * (scripts/lib/taxonomy-seed-data.mjs) — Wolf's approved canonical vocabulary
 * (W3, 2026-07-11): 5 categories + 26 tags distilled from 93 posts' drifted
 * frontmatter.
 *
 *   - the body parses under taxonomy.v1; the id passes T0.3; validation is
 *     clean (slug shape/uniqueness per kind, merge integrity);
 *   - term ids follow the server-mint convention t_<alnum(slug)>;
 *   - RAW_TO_CANONICAL is CLOSED both ways: every mapping target is a seeded
 *     canonical slug of that kind, and every seeded term is reachable from at
 *     least one raw string (no orphan terms, no dangling mappings) — this map
 *     is the input for step 2's frontmatter normalization pass.
 */
import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../packages/core/server/lib/object-validate.js';
import { validateObjectIdForType } from '../../packages/core/lib/object-ids.js';
import { taxonomyBodySchema, type TaxonomyBody } from '../../packages/core/schema/bodies/taxonomy-v1.js';
import { CONVERSION_SEEDS, RAW_TO_CANONICAL, SEED_SITE, taxonomyBody } from '../../scripts/lib/taxonomy-seed-data.mjs';

const body = taxonomyBody as TaxonomyBody;
const kinds = ['category', 'tag'] as const;

test('the batch is the single tax_drlurie registry for site_drlurie', () => {
  assert.equal(SEED_SITE, 'site_drlurie');
  assert.deepEqual(
    (CONVERSION_SEEDS as Array<{ objectType: string; objectId: string }>).map((seed) => [
      seed.objectType,
      seed.objectId,
    ]),
    [['taxonomy', 'tax_drlurie']]
  );
});

test('the body parses under taxonomy.v1, the id passes T0.3, and the approved counts hold', () => {
  const parsed = taxonomyBodySchema.safeParse(body);
  assert.ok(parsed.success, JSON.stringify(parsed.success ? '' : parsed.error.issues));
  assert.ok(validateObjectIdForType('taxonomy', 'tax_drlurie').ok);
  assert.equal(body.kinds.category.terms.length, 5);
  assert.equal(body.kinds.tag.terms.length, 26);
  for (const kind of kinds) {
    for (const term of body.kinds[kind].terms) {
      assert.equal(term.status, 'active', `${term.slug}: the seed carries only active terms`);
      assert.equal(term.term_id, `t_${term.slug.replace(/[^a-z0-9]/g, '')}`, `${term.slug}: mint-convention id`);
    }
  }
});

test('the registry validates clean (slug shape/uniqueness per kind, merge integrity)', () => {
  const summary = summarizeValidation(validateObject({ objectType: 'taxonomy', objectId: 'tax_drlurie', body }, {}));
  assert.deepEqual(summary.blockers, [], JSON.stringify(summary.blockers));
});

test('RAW_TO_CANONICAL is closed both ways per kind', () => {
  for (const kind of kinds) {
    const canonicalSlugs = new Set(body.kinds[kind].terms.map((term) => term.slug));
    const mapping = RAW_TO_CANONICAL[kind] as Record<string, string>;

    // Every mapping target is a real seeded term of that kind.
    for (const [raw, canonical] of Object.entries(mapping)) {
      assert.ok(canonicalSlugs.has(canonical), `${kind} mapping "${raw}" → "${canonical}" has no seeded term`);
    }
    // Every seeded term is reachable from at least one raw string (no orphans).
    const reachable = new Set(Object.values(mapping));
    for (const slug of canonicalSlugs) {
      assert.ok(reachable.has(slug), `${kind} term "${slug}" is unreachable from any raw frontmatter string`);
    }
  }
});
