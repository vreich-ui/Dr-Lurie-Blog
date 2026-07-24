/**
 * T10.6 — mint batch 2 (`timeline`, `comparison_table`) + the five ratified
 * bounded variant fields (design-vocabulary-gaps.md §7).
 *
 * Pins: batch-2 schema accept/reject; every variant field is
 * ADDITIVE-OPTIONAL — the exact pre-variant shapes still parse (the
 * M-9/columns precedent, so committed exports re-validate untouched) and
 * each new value is bounded; placeability + editor hints for the mints.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { comparisonTableDefinition } from '../../packages/core/lib/registry/components/comparison-table.js';
import { timelineDefinition } from '../../packages/core/lib/registry/components/timeline.js';
import { isStandalonePlaceableSectionType } from '../../packages/core/lib/registry/components/registered-types.js';
import { sectionInstanceSchema, sectionTypes } from '../../packages/core/schema/bodies/section-v1.js';

const instance = (type: string, data: unknown) => ({ id: 's_mintb2', type, data });
const parses = (type: string, data: unknown): boolean => sectionInstanceSchema.safeParse(instance(type, data)).success;

// ═══ timeline ═════════════════════════════════════════════════════════════════

test('timeline: 2–8 bounded milestones; singletons and over-long labels reject', () => {
  assert.ok(
    parses('timeline', {
      heading: 'What to expect',
      milestones: [
        { label: 'Start', period: 'Week 1', description: 'Adjustment.' },
        { label: 'Change', description: 'Visible results.' },
      ],
    })
  );
  assert.ok(!parses('timeline', { milestones: [{ label: 'Only one', description: 'x' }] }), 'min 2');
  assert.ok(
    !parses('timeline', {
      milestones: Array.from({ length: 9 }, (_, i) => ({ label: `m${i}`, description: 'x' })),
    }),
    'max 8'
  );
  assert.ok(
    !parses('timeline', {
      milestones: [
        { label: 'x'.repeat(65), description: 'x' },
        { label: 'ok', description: 'x' },
      ],
    }),
    'label ≤64'
  );
});

// ═══ comparison_table ═════════════════════════════════════════════════════════

test('comparison_table: 2–4 columns, ≤12 rows, boolean-or-short-string cells', () => {
  assert.ok(
    parses('comparison_table', {
      columns: [{ label: 'Us', highlighted: true }, { label: 'Them' }],
      rows: [
        { label: 'Evidence-based', cells: [true, false] },
        { label: 'Response time', cells: ['24h', '5 days'] },
      ],
    })
  );
  assert.ok(
    !parses('comparison_table', { columns: [{ label: 'Solo' }], rows: [{ label: 'r', cells: [true] }] }),
    'min 2 columns'
  );
  assert.ok(
    !parses('comparison_table', {
      columns: Array.from({ length: 5 }, (_, i) => ({ label: `c${i}` })),
      rows: [{ label: 'r', cells: [true, true, true, true, true] }],
    }),
    'max 4 columns (and max 4 cells)'
  );
  assert.ok(
    !parses('comparison_table', {
      columns: [{ label: 'A' }, { label: 'B' }],
      rows: [{ label: 'r', cells: ['x'.repeat(49), true] }],
    }),
    'cell strings ≤48'
  );
});

// ═══ ratified variant fields — additive-optional, bounded ═════════════════════

test('every ratified variant field is additive-optional: the exact pre-variant shapes still parse', () => {
  // These are the shapes committed exports carry TODAY — they must parse
  // unchanged (the byte-identity guarantee's schema half).
  assert.ok(parses('hero', { heading: 'H', actions: [] }));
  assert.ok(parses('cta_banner', { heading: 'H', actions: [] }));
  assert.ok(
    parses('content_split', {
      heading: 'H',
      body: '<p>Copy</p>',
      actions: [],
      images: [{ src: '/a.jpg', alt: 'a' }],
      reverse: true,
    })
  );
  assert.ok(parses('steps', { items: [{ title: 'One' }] }));
  assert.ok(parses('testimonial', { quotes: [{ quote: 'Great.' }] }));
});

test('variant values are bounded enums/literals; junk rejects', () => {
  assert.ok(parses('hero', { heading: 'H', actions: [], variant: 'split' }));
  assert.ok(!parses('hero', { heading: 'H', actions: [], variant: 'mega' }));
  assert.ok(parses('cta_banner', { heading: 'H', actions: [], compact: true }));
  assert.ok(!parses('cta_banner', { heading: 'H', actions: [], compact: 'yes' }));
  assert.ok(parses('content_split', { heading: 'H', body: '<p>x</p>', actions: [], images: [], imageLayout: 'stack' }));
  assert.ok(
    !parses('content_split', { heading: 'H', body: '<p>x</p>', actions: [], images: [], imageLayout: 'overlap' })
  );
  assert.ok(parses('steps', { items: [{ title: 'One' }], columns: 4 }));
  assert.ok(!parses('steps', { items: [{ title: 'One' }], columns: 5 }));
  assert.ok(parses('testimonial', { quotes: [], layout: 'wall', variant: 'pullquote' }));
  assert.ok(!parses('testimonial', { quotes: [], layout: 'masonry' }));
});

// ═══ registry ═════════════════════════════════════════════════════════════════

test('batch-2 mints are registered, standalone-placeable, and carry editor hints', () => {
  const definitions = { timeline: timelineDefinition, comparison_table: comparisonTableDefinition } as const;
  for (const type of ['timeline', 'comparison_table'] as const) {
    assert.ok(isStandalonePlaceableSectionType(type), `${type} is standalone-placeable`);
    assert.ok((definitions[type].editor.useWhen ?? '').length > 20, `${type} carries a real useWhen`);
    assert.ok((sectionTypes as readonly string[]).includes(type), `${type} in the union`);
  }
});
