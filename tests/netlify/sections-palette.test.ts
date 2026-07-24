import assert from 'node:assert/strict';
import test from 'node:test';

import { SECTION_PALETTE, insertPositionFor, paletteEntry } from '../../packages/core/lib/edit-mode/sections-palette.js';
import { splitRichTextBlocks, splitRichTextParagraphs } from '../../packages/core/lib/richtext/paragraphs.js';
import { sectionInstanceSchema } from '../../packages/core/schema/bodies/section-v1.js';

// Every palette starter must be insertable as-is: schema-valid under the REAL
// section.v1 union, and its rich-text fields must survive the real splitters
// (the render gate). A quick-add that 422s at patch time is a broken tool.
for (const entry of SECTION_PALETTE) {
  test(`palette starter for ${entry.type} is schema-valid and render-splittable`, () => {
    const parsed = sectionInstanceSchema.safeParse({ id: 's_probe', type: entry.type, data: entry.starter });
    assert.ok(parsed.success, JSON.stringify(parsed.success ? undefined : parsed.error.issues));

    // Rich-text starters use paragraph-only allowlist HTML — check with the
    // real splitters, never a re-implementation.
    const body = (entry.starter as { body?: string }).body;
    if (typeof body === 'string') {
      assert.doesNotThrow(() => splitRichTextParagraphs(body));
      assert.doesNotThrow(() => splitRichTextBlocks(body));
    }
  });
}

test('the palette offers only copy-composable types (no reference/binding starters)', () => {
  const offered = new Set(SECTION_PALETTE.map((entry) => entry.type));
  for (const excluded of ['product_preview', 'contact_form', 'search', 'content_embed', 'shared_ref']) {
    assert.equal(offered.has(excluded), false, `${excluded} needs references/bindings a quick-add cannot invent`);
  }
  // content_grid IS offered, but ONLY as the reference-free `related` source
  // (the algorithm selects posts at build time — nothing to invent). A
  // manual/query/cards starter would need refs and stays excluded.
  for (const entry of SECTION_PALETTE.filter((candidate) => candidate.type === 'content_grid')) {
    assert.equal((entry.starter as { source?: { kind?: string } }).source?.kind, 'related');
  }
  assert.ok(offered.has('prose'), 'plain text is the first thing an editor reaches for');
});

test('paletteEntry looks up by type', () => {
  assert.equal(paletteEntry('prose')?.label, 'Text');
  assert.equal(paletteEntry('nope'), undefined);
});

// ── insert position math (record-based, hidden-section safe) ────────────────
const sections = [{ id: 's_a' }, { id: 's_hidden' }, { id: 's_b' }];

test('insertPositionFor places before/after the anchor by RECORD index', () => {
  assert.equal(insertPositionFor(sections, 's_a', 'before'), 0);
  assert.equal(insertPositionFor(sections, 's_a', 'after'), 1);
  // s_b renders adjacent to s_a when s_hidden is hidden, but the record index
  // still counts it — inserting before s_b must land at index 2, not 1.
  assert.equal(insertPositionFor(sections, 's_b', 'before'), 2);
  assert.equal(insertPositionFor(sections, 's_b', 'after'), 3);
});

test('an unknown anchor appends instead of throwing mid-edit', () => {
  assert.equal(insertPositionFor(sections, 's_gone', 'before'), 3);
});

test('the empty-page anchor case: anchorId "" on an empty record appends at 0', () => {
  assert.equal(insertPositionFor([], '', 'after'), 0);
});
