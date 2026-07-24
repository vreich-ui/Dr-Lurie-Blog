import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideSelectedText, MAX_SELECTION_LENGTH } from './ask-ai-object-selection.js';

describe('decideSelectedText (selection UX with whole-object fallback)', () => {
  it('returns the trimmed span for a real in-target highlight', () => {
    assert.equal(
      decideSelectedText({ text: '  the barrier reset  ', isCollapsed: false, anchoredInTarget: true }),
      'the barrier reset'
    );
  });

  it('falls back to whole-object (undefined) when the selection is collapsed', () => {
    assert.equal(decideSelectedText({ text: 'x', isCollapsed: true, anchoredInTarget: true }), undefined);
  });

  it('falls back when the selection is anchored outside the edited unit', () => {
    assert.equal(decideSelectedText({ text: 'elsewhere', isCollapsed: false, anchoredInTarget: false }), undefined);
  });

  it('falls back when the selection trims to empty (whitespace only)', () => {
    assert.equal(decideSelectedText({ text: '   \n  ', isCollapsed: false, anchoredInTarget: true }), undefined);
  });

  it('falls back when the selection exceeds the endpoint length bound', () => {
    const tooLong = 'a'.repeat(MAX_SELECTION_LENGTH + 1);
    assert.equal(decideSelectedText({ text: tooLong, isCollapsed: false, anchoredInTarget: true }), undefined);
    const atBound = 'a'.repeat(MAX_SELECTION_LENGTH);
    assert.equal(decideSelectedText({ text: atBound, isCollapsed: false, anchoredInTarget: true }), atBound);
  });
});
