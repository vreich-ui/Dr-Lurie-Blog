/**
 * Drill-op construction for the round-trip driver
 * (scripts/lib/roundtrip-drill.mjs). Pins the three regressions the home-only
 * drill would have shipped into every future family conversion:
 *   1. the field probe must use a field the type's STRICT schema actually has
 *      (the old `{ kicker: 'probe' }` fails on `prose`, which is body-only);
 *   2. section visibility must restore to its ORIGINAL value, not a hard null;
 *   5. the page probe must be an allowed type (a clone of an existing inline
 *      section) under a collision-free id, and refuse an all-shared_ref page
 *      loudly rather than guessing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveProbeId,
  drillOpsForSeed,
  pageDrillOps,
  sectionDrillOps,
  sectionTemplateDrillOps,
  siteDrillOps,
  themeDrillOps,
  taxonomyDrillOps,
  templateDrillOps,
  updateDataProbeOps,
} from '../../scripts/lib/roundtrip-drill.mjs';

const updateOps = (ops) => ops.filter((op) => op.op === 'update_section_data');
const fieldKeys = (op) => Object.keys(op.fields);

test('updateDataProbeOps mutates + restores a plain-text field when present (hero)', () => {
  const data = { heading: 'Real Heading', kicker: 'Eyebrow', actions: [] };
  const { ops } = updateDataProbeOps('s_x', data);
  assert.equal(ops.length, 2);
  assert.deepEqual(ops[0].fields, { heading: 'Real Heading [probe]' });
  assert.deepEqual(ops[1].fields, { heading: 'Real Heading' }, 'restores the exact original');
});

test('updateDataProbeOps NEVER emits a field the data lacks — the fix-1 guarantee', () => {
  // prose is body-only under a strict schema; the old `{ kicker: 'probe' }`
  // probe would be rejected. Here the fallback sets an existing field to its
  // own value.
  const prose = { body: '<p>Terms of service.</p>' };
  const { ops } = updateDataProbeOps('s_prose', prose);
  for (const op of ops) {
    for (const key of fieldKeys(op)) {
      assert.ok(key in prose, `probe used '${key}', absent from prose data`);
    }
  }
  // Body-only fallback is a self-value no-op (byte-identical), still one real op.
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].fields, { body: '<p>Terms of service.</p>' });
});

test('sectionDrillOps restores original visibility, not a hard null (fix 2)', () => {
  const visible = { id: 's_v', type: 'hero', visibility: 'public', data: { heading: 'H', actions: [] } };
  const { ops, expected } = sectionDrillOps(visible);
  assert.deepEqual(expected, ['upsert_section', 'update_section_data', 'set_section_visibility']);
  const visOps = ops.filter((op) => op.op === 'set_section_visibility');
  assert.equal(visOps.at(-1).visibility, 'public', 'must restore to the original public, not null');

  const bare = { id: 's_b', type: 'hero', data: { heading: 'H', actions: [] } };
  const bareVis = sectionDrillOps(bare).ops.filter((op) => op.op === 'set_section_visibility');
  assert.equal(bareVis.at(-1).visibility, null, 'an originally-unset section restores to null');
});

test('sectionDrillOps on a content_grid cards section probes only real fields', () => {
  const grid = {
    id: 's_grid',
    type: 'content_grid',
    data: { kicker: 'Start here', heading: 'Begin', source: { kind: 'cards', cards: [{ title: 'A' }] }, limit: 4 },
  };
  const { ops } = sectionDrillOps(grid);
  for (const op of updateOps(ops)) {
    for (const key of fieldKeys(op)) assert.ok(key in grid.data, `probe used '${key}', absent from grid data`);
  }
});

test('pageDrillOps clones the first inline section as an allowed-type probe, removed at the end', () => {
  const page = {
    title: 'Home',
    sections: [
      { id: 's_hero', type: 'hero', data: { heading: 'Welcome', actions: [] } },
      { id: 's_ref', type: 'shared_ref', data: { section: 'sec_x' } },
    ],
  };
  const { ops, expected } = pageDrillOps(page, deriveProbeId(['s_hero', 's_ref']));
  assert.deepEqual(expected, [
    'set_page_meta',
    'upsert_section',
    'update_section_data',
    'move_section',
    'set_section_visibility',
    'remove_section',
  ]);
  const upsert = ops.find((op) => op.op === 'upsert_section');
  assert.equal(upsert.section.type, 'hero', 'probe type is the first inline section type (allowed by the PageType)');
  assert.equal(ops.at(-1).op, 'remove_section', 'the probe is removed last, leaving the body byte-identical');
  assert.equal(ops.at(-1).section_id, upsert.section.id);
  // set_page_meta round-trips the title.
  const metaOps = ops.filter((op) => op.op === 'set_page_meta');
  assert.deepEqual(metaOps.at(-1).fields, { title: 'Home' });
});

test('pageDrillOps handles a fully-decomposed (all-shared_ref) page via a shared_ref probe', () => {
  // The normal shape once every section is its own object (e.g. /about): the
  // probe duplicates one of the page's own references — resolvable + allowed.
  const page = {
    title: 'Refs',
    sections: [
      { id: 's_a', type: 'shared_ref', data: { section: 'sec_a' } },
      { id: 's_b', type: 'shared_ref', data: { section: 'sec_b' } },
    ],
  };
  const { ops } = pageDrillOps(page, deriveProbeId(['s_a', 's_b']));
  const upsert = ops.find((op) => op.op === 'upsert_section');
  assert.equal(upsert.section.type, 'shared_ref');
  assert.deepEqual(upsert.section.data, { section: 'sec_a' }, 'probe duplicates a real reference');
  // update_section_data on the shared_ref self-values the only field (section).
  const update = ops.find((op) => op.op === 'update_section_data');
  assert.deepEqual(Object.keys(update.fields), ['section']);
  assert.equal(ops.at(-1).op, 'remove_section', 'probe removed last → byte-identical');
});

test('pageDrillOps throws only when a page has no clonable section AND no declared probe', () => {
  assert.throws(() => pageDrillOps({ title: 'Empty', sections: [] }, 's_rtprobe'), /no section with data/);
});

test('pageDrillOps drills a section-less page from a declared drillProbe (W6 content_detail)', () => {
  const page = { title: 'Article', sections: [] };
  const probe = { type: 'cta_banner', data: { heading: 'Probe', body: '<p>probe</p>', actions: [] } };
  const { expected, ops } = pageDrillOps(page, 's_rtprobe', probe);
  assert.deepEqual(expected, [
    'set_page_meta',
    'upsert_section',
    'update_section_data',
    'move_section',
    'set_section_visibility',
    'remove_section',
  ]);
  const upsert = ops.find((op) => op.op === 'upsert_section');
  assert.equal(upsert.section.type, 'cta_banner');
  assert.notEqual(upsert.section.data, probe.data, 'probe data is cloned, never shared');
  assert.deepEqual(upsert.section.data, probe.data);
  assert.equal(ops.at(-1).op, 'remove_section', 'probe removed last → byte-identical (still zero sections)');
});

test('drillOpsForSeed passes the seed drillProbe through for pages', () => {
  const seed = {
    objectType: 'page',
    objectId: 'page_article',
    body: { title: 'Article', sections: [] },
    drillProbe: { type: 'cta_banner', data: { heading: 'Probe', actions: [] } },
  };
  const { ops } = drillOpsForSeed(seed);
  assert.equal(ops.find((op) => op.op === 'upsert_section').section.type, 'cta_banner');
});

test('a page with its own sections ignores the declared probe — the clone stays PageType-proven', () => {
  const page = {
    title: 'Listing',
    sections: [{ id: 's_head', type: 'lede', data: { heading: 'Library', actions: [] } }],
  };
  const probe = { type: 'cta_banner', data: { heading: 'Probe', actions: [] } };
  const { ops } = pageDrillOps(page, 's_rtprobe', probe);
  assert.equal(ops.find((op) => op.op === 'upsert_section').section.type, 'lede');
});

test('deriveProbeId avoids collisions with existing section ids', () => {
  assert.equal(deriveProbeId(['s_hero', 's_bio']), 's_rtprobe');
  assert.equal(deriveProbeId(['s_rtprobe', 's_hero']), 's_rtprobe2');
  assert.equal(deriveProbeId(['s_rtprobe', 's_rtprobe2']), 's_rtprobe3');
});

test('templateDrillOps exercises all four template ops via an always-legal probe slot, byte-identical', () => {
  const body = {
    name: 'Interior page',
    appliesTo: ['standard'],
    slots: [
      { slotId: 'slot_lede', allowed: ['lede'], required: true, repeatable: false },
      { slotId: 'slot_body', allowed: ['prose'], required: false, repeatable: true },
    ],
  };
  const { ops, expected } = templateDrillOps(body, 'slot_rtprobe');
  assert.deepEqual(expected, ['set_template_meta', 'upsert_slot', 'move_slot', 'remove_slot']);

  // Name round-trips to the exact original.
  const metaOps = ops.filter((op) => op.op === 'set_template_meta');
  assert.deepEqual(metaOps[0].fields, { name: 'Interior page [probe]' });
  assert.deepEqual(metaOps.at(-1).fields, { name: 'Interior page' });

  // The probe slot is optional + clones an allowed type the template already
  // sanctions (registry-legal by construction), appended at the end.
  const upsert = ops.find((op) => op.op === 'upsert_slot');
  assert.deepEqual(upsert.slot, { slotId: 'slot_rtprobe', allowed: ['lede'], required: false, repeatable: false });
  assert.equal(upsert.position, 2);

  // Moved to the front and back, then removed last → byte-identical body.
  const moves = ops.filter((op) => op.op === 'move_slot');
  assert.deepEqual(
    moves.map((op) => op.to_index),
    [0, 2]
  );
  assert.deepEqual(ops.at(-1), { op: 'remove_slot', slot_id: 'slot_rtprobe' });
});

test('templateDrillOps falls back to a prose probe for a template with no allowed types yet', () => {
  const { ops } = templateDrillOps({ name: 'Bare', appliesTo: [], slots: [] }, 'slot_rtprobe');
  const upsert = ops.find((op) => op.op === 'upsert_slot');
  assert.deepEqual(upsert.slot.allowed, ['prose']);
  assert.equal(upsert.position, 0);
});

test('taxonomyDrillOps exercises all five term ops via a probe tag, byte-identical', () => {
  const body = {
    kinds: {
      category: { terms: [{ term_id: 't_skinhealth', slug: 'skin-health', label: 'Skin Health', status: 'active' }] },
      tag: { terms: [{ term_id: 't_retinoids', slug: 'retinoids', label: 'Retinoids', status: 'active' }] },
    },
  };
  const { ops, expected } = taxonomyDrillOps(body, 't_rtprobe');
  assert.deepEqual(expected, ['add_term', 'update_term', 'deprecate_term', 'reactivate_term', 'remove_term']);
  assert.deepEqual(
    ops.map((op) => op.op),
    ['add_term', 'update_term', 'update_term', 'deprecate_term', 'reactivate_term', 'remove_term']
  );
  // The probe is added and removed in the tag kind; label round-trips exactly.
  assert.equal(ops[0].term.term_id, 't_rtprobe');
  assert.equal(ops[0].term.status, 'active');
  assert.deepEqual(ops[2].fields, { label: ops[0].term.label });
  assert.deepEqual(ops.at(-1), { op: 'remove_term', kind: 'tag', term_id: 't_rtprobe' });
  assert.ok(
    ops.every((op) => op.kind === 'tag'),
    'the probe lives entirely in the tag kind'
  );
});

test('drillOpsForSeed derives a collision-free probe term id across BOTH kinds', () => {
  const seed = {
    objectType: 'taxonomy',
    body: {
      kinds: {
        category: { terms: [{ term_id: 't_rtprobe', slug: 'x', label: 'X', status: 'active' }] },
        tag: { terms: [{ term_id: 't_rtprobe2', slug: 'y', label: 'Y', status: 'active' }] },
      },
    },
  };
  const { ops } = drillOpsForSeed(seed);
  assert.equal(ops[0].term.term_id, 't_rtprobe3');
});

test('drillOpsForSeed dispatches by object type', () => {
  const sectionSeed = {
    objectType: 'section',
    body: { section: { id: 's_s', type: 'prose', data: { body: '<p>x</p>' } } },
  };
  assert.deepEqual(drillOpsForSeed(sectionSeed).expected, [
    'upsert_section',
    'update_section_data',
    'set_section_visibility',
    'set_tracking',
  ]);
  const pageSeed = {
    objectType: 'page',
    body: { title: 'P', sections: [{ id: 's_h', type: 'hero', data: { heading: 'H', actions: [] } }] },
  };
  assert.equal(drillOpsForSeed(pageSeed).expected.length, 7);
  const templateSeed = {
    objectType: 'template',
    body: {
      name: 'T',
      appliesTo: ['standard'],
      // A slot already holding the default probe id forces the collision-free fallback.
      slots: [{ slotId: 'slot_rtprobe', allowed: ['prose'], required: false, repeatable: false }],
    },
  };
  const templateDrill = drillOpsForSeed(templateSeed);
  assert.equal(templateDrill.expected.length, 5);
  assert.equal(templateDrill.ops.find((op) => op.op === 'upsert_slot').slot.slotId, 'slot_rtprobe2');
});

test('sectionTemplateDrillOps exercises all three ops, byte-identical (W8.1)', () => {
  const body = {
    name: 'Landing hero',
    blueprint: {
      id: 's_stplhero',
      type: 'hero',
      data: { kicker: 'Overview', heading: 'New hero heading', actions: [] },
    },
  };
  const { ops, expected } = sectionTemplateDrillOps(body);
  assert.deepEqual(expected, ['set_section_template_meta', 'replace_blueprint', 'update_blueprint_data']);
  assert.deepEqual(ops, [
    { op: 'set_section_template_meta', fields: { name: 'Landing hero [probe]' } },
    { op: 'set_section_template_meta', fields: { name: 'Landing hero' } },
    { op: 'update_blueprint_data', fields: { heading: 'New hero heading [probe]' } },
    { op: 'update_blueprint_data', fields: { heading: 'New hero heading' } },
    { op: 'replace_blueprint', blueprint: body.blueprint },
  ]);
  // The replace payload is a CLONE, not the seed's own object reference.
  assert.notEqual(ops[4].blueprint, body.blueprint);
});

test('drillOpsForSeed dispatches a section_template seed', () => {
  const seed = {
    objectType: 'section_template',
    body: { name: 'R', blueprint: { id: 's_x', type: 'cta_banner', data: { heading: 'Go', actions: [] } } },
  };
  assert.deepEqual(drillOpsForSeed(seed).expected, [
    'set_section_template_meta',
    'replace_blueprint',
    'update_blueprint_data',
    'set_tracking',
  ]);
});

test('themeDrillOps pokes and restores the name — set_theme_fields is the only theme op (W8.3)', () => {
  const body = { name: 'Default', tokens: { colors: {}, fonts: { sans: 'x', serif: 'y', heading: 'z' } } };
  const { ops, expected } = themeDrillOps(body);
  assert.deepEqual(expected, ['set_theme_fields']);
  assert.deepEqual(ops, [
    { op: 'set_theme_fields', fields: { name: 'Default [probe]' } },
    { op: 'set_theme_fields', fields: { name: 'Default' } },
  ]);
});

test('drillOpsForSeed dispatches a theme seed', () => {
  const seed = { objectType: 'theme', body: { name: 'D', tokens: { colors: {}, fonts: {} } } };
  assert.deepEqual(drillOpsForSeed(seed).expected, ['set_theme_fields', 'set_tracking']);
});

test('siteDrillOps pokes and restores the name — set_site_fields is the only site op', () => {
  const body = { name: 'Dr. Lurié', logo: { text: 'DR. LURIÉ SCIENCE' } };
  const { ops, expected } = siteDrillOps(body);
  assert.deepEqual(expected, ['set_site_fields']);
  assert.deepEqual(ops, [
    { op: 'set_site_fields', fields: { name: 'Dr. Lurié [probe]' } },
    { op: 'set_site_fields', fields: { name: 'Dr. Lurié' } },
  ]);
});

test('drillOpsForSeed dispatches a site seed to siteDrillOps', () => {
  const seed = { objectType: 'site', body: { name: 'Dr. Lurié' } };
  assert.deepEqual(drillOpsForSeed(seed).expected, ['set_site_fields', 'set_tracking']);
});

test('every drill appends the W13 set_tracking probe, restoring byte-exactly (T10.8)', () => {
  // A body with NO tracking block: the restore is `fields: null` — removes
  // body.tracking entirely (the grammar's exact first-set inverse).
  const bare = drillOpsForSeed({ objectType: 'site', body: { name: 'S' } });
  const bareTracking = bare.ops.filter((op) => op.op === 'set_tracking');
  assert.deepEqual(bareTracking, [
    { op: 'set_tracking', fields: { label: 'RT probe' } },
    { op: 'set_tracking', fields: null },
  ]);
  assert.equal(bare.ops.at(-1).op, 'set_tracking', 'tracking probe runs last');

  // A body WITH a tracking label: the restore writes the original back.
  const labeled = drillOpsForSeed({
    objectType: 'theme',
    body: { name: 'D', tokens: { colors: {}, fonts: {} }, tracking: { label: 'Theme reporting' } },
  });
  assert.deepEqual(
    labeled.ops.filter((op) => op.op === 'set_tracking'),
    [
      { op: 'set_tracking', fields: { label: 'RT probe' } },
      { op: 'set_tracking', fields: { label: 'Theme reporting' } },
    ]
  );

  // A tracking block WITHOUT a label key: restore unsets the probe's label
  // (deep-merge would otherwise leave it behind).
  const unlabeled = drillOpsForSeed({
    objectType: 'site',
    body: { name: 'S', tracking: { enabled: true } },
  });
  assert.deepEqual(unlabeled.ops.at(-1), { op: 'set_tracking', fields: { label: null } });
});
