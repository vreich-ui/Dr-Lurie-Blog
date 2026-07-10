/**
 * Reconcile-op construction for the round-trip driver
 * (scripts/lib/roundtrip-reconcile.mjs). The regression pinned here is the
 * 2026-07-10 production heal of page_home: `set_page_meta` deep-merges, so
 * nested keys the target omits (the record's stray `seo.description` /
 * `seo.robots` / `seo.title`) survived the merge and the healed body failed
 * the byte-identical check. Strays must be explicitly nulled at every depth
 * (playbook trap 2).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { diffFieldsForMerge, reconcileOps } from '../../scripts/lib/roundtrip-reconcile.mjs';

// The engine's documented merge semantics, mirrored for verification: objects
// deep-merge, null deletes, scalars/arrays replace.
const applyMerge = (base, fields) => {
  const result = { ...base };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) delete result[key];
    else if (value && typeof value === 'object' && !Array.isArray(value))
      result[key] = applyMerge(
        base[key] && typeof base[key] === 'object' && !Array.isArray(base[key]) ? base[key] : {},
        value
      );
    else result[key] = value;
  }
  return result;
};

test('diffFieldsForMerge nulls stray keys at every depth (the page_home seo regression)', () => {
  const target = { seo: { ogImage: '/Social/og-home.jpg' }, title: 'T' };
  const current = {
    seo: {
      ogImage: '/Social/og-home.jpg',
      description: 'stray description',
      robots: { index: true, follow: true },
      title: 'stray seo title',
    },
    title: 'Old title',
    template: { ref: 'tpl_x', instantiated_at: '2026-01-01T00:00:00.000Z' },
  };
  const fields = diffFieldsForMerge(target, current);
  assert.deepEqual(applyMerge(current, fields), target, 'merge(current, fields) must equal the target exactly');
  // The strays are explicit nulls, not omissions.
  assert.equal(fields.seo.description, null);
  assert.equal(fields.seo.robots, null);
  assert.equal(fields.seo.title, null);
  assert.equal(fields.template, null);
});

test('diffFieldsForMerge replaces scalars/arrays wholesale and recurses only object-to-object', () => {
  const target = { a: [1, 2], b: { c: 1 }, d: 'x' };
  const current = { a: [9], b: 'was-a-string', d: 'y' };
  const fields = diffFieldsForMerge(target, current);
  assert.deepEqual(applyMerge(current, fields), target);
  assert.deepEqual(fields.a, [1, 2], 'arrays replace wholesale');
  assert.deepEqual(fields.b, { c: 1 }, 'type-changed values replace wholesale');
});

test('reconcileOps for a section object is a single wholesale upsert', () => {
  const seed = { objectType: 'section', objectId: 'sec_x', body: { section: { id: 's_x', type: 'prose', data: {} } } };
  assert.deepEqual(reconcileOps(seed, { section: { id: 's_other', type: 'hero', data: {} } }), [
    { op: 'upsert_section', section: seed.body.section },
  ]);
});

test('reconcileOps for a page heals meta (with nested nulls), sections, strays, and order', () => {
  const target = {
    route: '/',
    pageType: 'home',
    title: 'Home',
    seo: { ogImage: '/og.jpg' },
    navigationOverrides: { footer: 'nav_footer_home' },
    sections: [
      { id: 's_hero', type: 'hero', data: { heading: 'H', actions: [] } },
      { id: 's_ref', type: 'shared_ref', data: { section: 'sec_x' } },
    ],
  };
  const current = {
    route: '/',
    pageType: 'home',
    title: 'Home (broken)',
    seo: { ogImage: '/og.jpg', description: 'stray' },
    sections: [{ id: 's_stray', type: 'hero', data: { heading: 'stray', actions: [] } }],
  };
  const ops = reconcileOps({ objectType: 'page', objectId: 'page_home', body: target }, current);

  assert.equal(ops[0].op, 'set_page_meta', 'meta first, so structure_home_footer sees the footer immediately');
  assert.equal(ops[0].fields.seo.description, null, 'nested stray nulled');
  assert.deepEqual(ops[0].fields.navigationOverrides, { footer: 'nav_footer_home' });

  const opNames = ops.map((op) => op.op);
  assert.deepEqual(opNames, [
    'set_page_meta',
    'upsert_section',
    'upsert_section',
    'remove_section',
    'move_section',
    'move_section',
  ]);
  assert.equal(ops[3].section_id, 's_stray');
  assert.deepEqual(
    ops.slice(4).map((op) => [op.section_id, op.to_index]),
    [
      ['s_hero', 0],
      ['s_ref', 1],
    ]
  );
});
