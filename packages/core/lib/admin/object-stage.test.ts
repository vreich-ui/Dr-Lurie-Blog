import { describe, it } from 'node:test';
import assert from 'node:assert';

import { objectStageMode, objectStageModeClass } from './object-stage.js';

describe('objectStageMode', () => {
  it('uses a document-shaped stage for reading and specification objects', () => {
    assert.strictEqual(objectStageMode('content_item'), 'document');
    assert.strictEqual(objectStageMode('editorial_voice'), 'document');
    assert.strictEqual(objectStageMode('section_template'), 'document');
  });

  it('keeps web structure wide and gives visual products a media frame', () => {
    assert.strictEqual(objectStageMode('page'), 'wide');
    assert.strictEqual(objectStageMode('section'), 'wide');
    assert.strictEqual(objectStageMode('navigation'), 'wide');
    assert.strictEqual(objectStageMode('product'), 'media');
  });

  it('provides a non-empty frame class for every mode', () => {
    for (const mode of ['document', 'wide', 'media'] as const) assert.ok(objectStageModeClass(mode));
  });
});
