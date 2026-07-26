/**
 * Publish-time taxonomy enforcement (netlify/lib/taxonomy-enforcement.ts) —
 * the W3 step 2 resolution semantics (§5.5/§5.6-step-2), unit-tested against
 * an injected registry loader (no blob store):
 *
 *   - no registry / unreadable / malformed → skipped (publishing untouched);
 *   - strings resolve BY SLUG (labels and slugs both work); resolved output is
 *     the canonical slug, deduplicated;
 *   - deprecated terms follow merged_into to their active successor (with a
 *     cycle guard); deprecated without a successor rejects;
 *   - any string resolving to no term rejects, listing every offender.
 */
import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { enforceTaxonomy } from '../../packages/core/server/lib/taxonomy-enforcement.js';

const registry = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    object_id: 'tax_drlurie',
    body: {
      kinds: {
        category: {
          terms: [
            { term_id: 't_skinhealth', slug: 'skin-health', label: 'Skin Health', status: 'active' },
            { term_id: 't_reflections', slug: 'reflections', label: 'Reflections', status: 'active' },
          ],
        },
        tag: {
          terms: [
            { term_id: 't_skinbarrier', slug: 'skin-barrier', label: 'Skin Barrier', status: 'active' },
            { term_id: 't_retinoids', slug: 'retinoids', label: 'Retinoids', status: 'active' },
            // A deprecated alias pointing at its successor (the rename mechanism).
            {
              term_id: 't_retinol',
              slug: 'retinol',
              label: 'Retinol',
              status: 'deprecated',
              merged_into: 't_retinoids',
            },
            // Deprecated with NO successor — must not resolve.
            { term_id: 't_dead', slug: 'dead-end', label: 'Dead End', status: 'deprecated' },
          ],
        },
      },
      ...overrides,
    },
  });

const load = (raw: string | null) => async () => raw;

test('no registry record → skipped (publishing behaves exactly as before)', async () => {
  const result = await enforceTaxonomy(load(null), 'Anything Goes', ['whatever']);
  assert.deepEqual(result, { status: 'skipped', reason: 'registry_unavailable' });
});

test('an unreadable or malformed registry skips rather than bricking publishes', async () => {
  const throwing = async () => {
    throw new Error('store unavailable');
  };
  assert.equal((await enforceTaxonomy(throwing, 'X', [])).status, 'skipped');
  assert.equal((await enforceTaxonomy(load('not json'), 'X', [])).status, 'skipped');
  assert.equal((await enforceTaxonomy(load(JSON.stringify({ body: {} })), 'X', [])).status, 'skipped');
});

test('labels and slugs both resolve BY SLUG; output is canonical slugs, deduplicated', async () => {
  const result = await enforceTaxonomy(load(registry()), 'Skin Health', ['Skin Barrier', 'skin-barrier', 'retinoids']);
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.equal(result.category, 'skin-health');
    assert.deepEqual(result.tags, ['skin-barrier', 'retinoids']); // deduped, canonical
    assert.deepEqual(result.term_ids, ['t_skinhealth', 't_skinbarrier', 't_retinoids']);
  }
});

test('a deprecated term follows merged_into to its active successor', async () => {
  const result = await enforceTaxonomy(load(registry()), undefined, ['retinol']);
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') {
    assert.deepEqual(result.tags, ['retinoids']);
    assert.deepEqual(result.term_ids, ['t_retinoids']);
  }
});

test('deprecated without a successor, and unknown strings, reject — listing every offender', async () => {
  const result = await enforceTaxonomy(load(registry()), 'Smoke Test', ['dead-end', 'skin-barrier', 't7']);
  assert.equal(result.status, 'rejected');
  if (result.status === 'rejected') {
    assert.deepEqual(result.unresolved, ['category "Smoke Test"', 'tag "dead-end"', 'tag "t7"']);
  }
});

test('kinds are separate registries: a category slug does not resolve as a tag', async () => {
  const result = await enforceTaxonomy(load(registry()), undefined, ['reflections']);
  assert.equal(result.status, 'rejected');
});

test('no category and no tags → ok with empty resolution', async () => {
  const result = await enforceTaxonomy(load(registry()), undefined, []);
  assert.deepEqual(result, { status: 'ok', category: undefined, tags: [], term_ids: [] });
});

test('a merged_into cycle cannot loop forever — it rejects', async () => {
  const cyclic = JSON.stringify({
    body: {
      kinds: {
        category: { terms: [] },
        tag: {
          terms: [
            { term_id: 't_a', slug: 'a', label: 'A', status: 'deprecated', merged_into: 't_b' },
            { term_id: 't_b', slug: 'b', label: 'B', status: 'deprecated', merged_into: 't_a' },
          ],
        },
      },
    },
  });
  const result = await enforceTaxonomy(load(cyclic), undefined, ['a']);
  assert.equal(result.status, 'rejected');
});
