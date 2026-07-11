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

test('reconcileOps for a taxonomy rebuilds ONLY the drifted kind, wholesale and in seed order', () => {
  const target = {
    kinds: {
      category: { terms: [{ term_id: 't_skinhealth', slug: 'skin-health', label: 'Skin Health', status: 'active' }] },
      tag: {
        terms: [
          { term_id: 't_skinbarrier', slug: 'skin-barrier', label: 'Skin Barrier', status: 'active' },
          { term_id: 't_retinoids', slug: 'retinoids', label: 'Retinoids', status: 'active' },
        ],
      },
    },
  };
  const current = {
    kinds: {
      // category kind matches the seed exactly → untouched.
      category: { terms: [{ term_id: 't_skinhealth', slug: 'skin-health', label: 'Skin Health', status: 'active' }] },
      // tag kind drifted: stray term, wrong order, drifted label.
      tag: {
        terms: [
          { term_id: 't_stray', slug: 'stray', label: 'Stray', status: 'active' },
          { term_id: 't_retinoids', slug: 'retinoids', label: 'Retinoids (drifted)', status: 'active' },
        ],
      },
    },
  };
  const ops = reconcileOps({ objectType: 'taxonomy', objectId: 'tax_drlurie', body: target }, current);

  assert.ok(
    ops.every((op) => op.kind === 'tag'),
    'the matching category kind is untouched'
  );
  assert.deepEqual(
    ops.map((op) => op.op),
    ['remove_term', 'remove_term', 'add_term', 'add_term']
  );
  // Removal in reverse order; re-add carries the FULL seed payload at position.
  assert.deepEqual(
    ops.slice(0, 2).map((op) => op.term_id),
    ['t_retinoids', 't_stray']
  );
  assert.deepEqual(ops[2].term, target.kinds.tag.terms[0]);
  assert.equal(ops[2].position, 0);
  assert.deepEqual(ops[3].term, target.kinds.tag.terms[1]);
  assert.equal(ops[3].position, 1);
});

test('reconcileOps for a template heals meta (slots excluded), slots, strays, and order', () => {
  const target = {
    name: 'Interior page',
    appliesTo: ['standard'],
    slots: [
      { slotId: 'slot_lede', allowed: ['lede'], required: true, repeatable: false },
      { slotId: 'slot_body', allowed: ['prose'], required: false, repeatable: true },
    ],
  };
  const current = {
    name: 'Interior page (drifted)',
    appliesTo: ['standard', 'system'],
    slots: [
      { slotId: 'slot_stray', allowed: ['hero'], required: false, repeatable: false },
      { slotId: 'slot_body', allowed: ['prose'], required: true, repeatable: true },
    ],
  };
  const ops = reconcileOps({ objectType: 'template', objectId: 'tpl_interior', body: target }, current);

  // set_template_meta forbids `slots` — the meta diff must never carry them.
  assert.equal(ops[0].op, 'set_template_meta');
  assert.ok(!('slots' in ops[0].fields), 'slots are owned by the slot ops, never set_template_meta');
  assert.equal(ops[0].fields.name, 'Interior page');
  assert.deepEqual(ops[0].fields.appliesTo, ['standard'], 'arrays replace wholesale');

  assert.deepEqual(
    ops.map((op) => op.op),
    ['set_template_meta', 'upsert_slot', 'upsert_slot', 'remove_slot', 'move_slot', 'move_slot']
  );
  // Positioned wholesale upserts (heals slot_body's drifted `required` flag).
  assert.deepEqual(ops[1].slot, target.slots[0]);
  assert.equal(ops[1].position, 0);
  assert.deepEqual(ops[2].slot, target.slots[1]);
  assert.equal(ops[3].slot_id, 'slot_stray');
  assert.deepEqual(
    ops.slice(4).map((op) => [op.slot_id, op.to_index]),
    [
      ['slot_lede', 0],
      ['slot_body', 1],
    ]
  );
});

test('reconcileOps for a site singleton is one deep-merge diff that nulls strays at depth', () => {
  const target = {
    name: 'Dr. Lurié',
    chrome: { showRssFeed: true, showThemeToggle: true },
    blog: { listPath: 'learn/library', postsPerPage: 6 },
  };
  const current = {
    name: 'Dr. Lurié (drifted)',
    chrome: { showRssFeed: true, showThemeToggle: false, stray: 'x' },
    blog: { listPath: 'learn/library', postsPerPage: 6 },
    strayTop: { a: 1 },
  };
  const ops = reconcileOps({ objectType: 'site', objectId: 'site_drlurie', body: target }, current);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'set_site_fields');
  assert.equal(ops[0].fields.name, 'Dr. Lurié');
  assert.equal(ops[0].fields.chrome.showThemeToggle, true);
  assert.equal(ops[0].fields.chrome.stray, null, 'nested stray key must be explicitly nulled (trap 2)');
  assert.equal(ops[0].fields.strayTop, null, 'top-level stray key must be explicitly nulled');
});
