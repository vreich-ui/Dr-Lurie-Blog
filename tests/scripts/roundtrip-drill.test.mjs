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

test('pageDrillOps refuses an all-shared_ref page instead of guessing (fix 5)', () => {
  const page = { title: 'Refs', sections: [{ id: 's_a', type: 'shared_ref', data: { section: 'sec_a' } }] };
  assert.throws(() => pageDrillOps(page, 's_rtprobe'), /only shared_ref sections/);
});

test('deriveProbeId avoids collisions with existing section ids', () => {
  assert.equal(deriveProbeId(['s_hero', 's_bio']), 's_rtprobe');
  assert.equal(deriveProbeId(['s_rtprobe', 's_hero']), 's_rtprobe2');
  assert.equal(deriveProbeId(['s_rtprobe', 's_rtprobe2']), 's_rtprobe3');
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
  ]);
  const pageSeed = {
    objectType: 'page',
    body: { title: 'P', sections: [{ id: 's_h', type: 'hero', data: { heading: 'H', actions: [] } }] },
  };
  assert.equal(drillOpsForSeed(pageSeed).expected.length, 6);
});
