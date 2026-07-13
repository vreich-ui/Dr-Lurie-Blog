/**
 * The `random` related-grid algorithm's engine (Slice D): a seeded shuffle
 * that must be DETERMINISTIC (same seed → same order — no build-diff churn),
 * VARIED (different seeds → different orders — variety per article), and PURE
 * (never mutates the input).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { seededShuffle } from '../../src/utils/seeded-shuffle.js';

const items = Array.from({ length: 12 }, (_, index) => `p${index}`);

test('same seed yields the same order (reproducible builds)', () => {
  assert.deepEqual(seededShuffle(items, 'related:req_a'), seededShuffle(items, 'related:req_a'));
});

test('different seeds usually yield different orders (variety per article)', () => {
  const a = seededShuffle(items, 'related:req_a');
  const b = seededShuffle(items, 'related:req_b');
  assert.notDeepEqual(a, b);
});

test('it is a permutation and never mutates the input', () => {
  const input = [...items];
  const out = seededShuffle(input, 'seed');
  assert.deepEqual(input, items, 'input untouched');
  assert.deepEqual([...out].sort(), [...items].sort(), 'same multiset');
  assert.equal(out.length, items.length);
});

test('empty and single-element inputs are safe', () => {
  assert.deepEqual(seededShuffle([], 'x'), []);
  assert.deepEqual(seededShuffle(['only'], 'x'), ['only']);
});
