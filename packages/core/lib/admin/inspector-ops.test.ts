import { describe, it } from 'node:test';
import assert from 'node:assert';

import { mergeNullingValue, buildFieldsPatchOp, strandsKeys } from './inspector-ops.js';

describe('mergeNullingValue', () => {
  it('replaces scalars and arrays wholesale', () => {
    assert.strictEqual(mergeNullingValue('a', 'b'), 'a');
    assert.strictEqual(mergeNullingValue(3, 1), 3);
    assert.deepStrictEqual(mergeNullingValue([1, 2], [9]), [1, 2]);
  });

  it('nulls old discriminated-union keys on a variant switch (trap #2)', () => {
    const current = { kind: 'cards', cards: [{ id: 'c1' }], items: ['x'] };
    const next = { kind: 'query', query: { tag: 'skin' } };
    assert.deepStrictEqual(mergeNullingValue(next, current), {
      kind: 'query',
      query: { tag: 'skin' },
      cards: null,
      items: null,
    });
  });

  it('nulls strays recursively at every depth (trap #10)', () => {
    const current = { a: { b: 1, c: 2 }, d: { e: { f: 1, g: 2 } } };
    const next = { a: { b: 5 }, d: { e: { f: 1 } } };
    assert.deepStrictEqual(mergeNullingValue(next, current), {
      a: { b: 5, c: null },
      d: { e: { f: 1, g: null } },
    });
  });

  it('keeps untouched keys and adds new ones', () => {
    const current = { title: 'Old', seo: { description: 'd' } };
    const next = { title: 'New', seo: { description: 'd' }, deck: 'hi' };
    assert.deepStrictEqual(mergeNullingValue(next, current), {
      title: 'New',
      seo: { description: 'd' },
      deck: 'hi',
    });
  });

  it('replaces an object with a scalar wholesale (no null-out)', () => {
    assert.strictEqual(mergeNullingValue('now-a-string', { was: 'object' }), 'now-a-string');
  });
});

describe('buildFieldsPatchOp', () => {
  it('wraps the nulling value under the given op + field', () => {
    const op = buildFieldsPatchOp(
      'update_section_data',
      'source',
      { kind: 'query', query: { tag: 'x' } },
      { kind: 'cards', cards: [1] }
    );
    assert.deepStrictEqual(op, {
      op: 'update_section_data',
      fields: { source: { kind: 'query', query: { tag: 'x' }, cards: null } },
    });
  });
});

describe('strandsKeys', () => {
  it('detects a stranded key (needs explicit null)', () => {
    assert.strictEqual(strandsKeys({ kind: 'query' }, { kind: 'cards', cards: [1] }), true);
    assert.strictEqual(strandsKeys({ a: { b: 1 } }, { a: { b: 1, c: 2 } }), true);
  });
  it('is false when nothing is dropped', () => {
    assert.strictEqual(strandsKeys({ a: 1, b: 2 }, { a: 9 }), false);
    assert.strictEqual(strandsKeys('x', 'y'), false);
  });
});
