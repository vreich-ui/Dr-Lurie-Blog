import assert from 'node:assert/strict';
import test from 'node:test';

import {
  childRuleFor,
  isContainerType,
  isLegalBlockTree,
  validateBlockTree,
  type BlockNode,
} from '../../src/lib/registry/block-tree.js';

// A grid an agent composed from card leaves — the worked example in
// docs/cms-architecture/block-tree.md.
const gridOfCards = (cardCount: number): BlockNode => ({
  id: 's_grid',
  type: 'content_grid',
  data: { source: { kind: 'manual', items: [] }, limit: 8 },
  children: Array.from({ length: cardCount }, (_, i) => ({
    id: `s_card${i}`,
    type: 'card' as const,
    data: { title: `Card ${i}` },
  })),
});

test('rules are derived from the registry: content_grid is a container of cards, card is a leaf', () => {
  assert.deepEqual(childRuleFor('content_grid'), { allowedChildren: ['card'], childCount: { max: 8 } });
  assert.equal(isContainerType('content_grid'), true);
  assert.equal(childRuleFor('card'), undefined);
  assert.equal(isContainerType('card'), false);
  // A type that hasn't declared bounds is a leaf.
  assert.equal(isContainerType('hero'), false);
});

test('a legal tree (grid of cards) passes', () => {
  assert.deepEqual(validateBlockTree(gridOfCards(3)), []);
  assert.equal(isLegalBlockTree(gridOfCards(0)), true);
  assert.equal(isLegalBlockTree(gridOfCards(8)), true);
});

test('BOUNDED: a disallowed child type is rejected, with its path', () => {
  const tree: BlockNode = {
    id: 's_grid',
    type: 'content_grid',
    children: [
      { id: 's_card0', type: 'card', data: { title: 'ok' } },
      { id: 's_hero0', type: 'hero', data: { heading: 'nope', actions: [] } },
    ],
  };
  const errors = validateBlockTree(tree);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'child_type_not_allowed');
  assert.deepEqual(errors[0].path, ['s_grid', 's_hero0']);
});

test('BOUNDED: cardinality — over the max is rejected', () => {
  const errors = validateBlockTree(gridOfCards(9));
  assert.equal(
    errors.some((e) => e.code === 'too_many_children'),
    true
  );
});

test('BOUNDED: a leaf may not contain children', () => {
  const tree: BlockNode = {
    id: 's_card',
    type: 'card',
    data: { title: 'leaf' },
    children: [{ id: 's_x', type: 'card', data: { title: 'illegal nesting' } }],
  };
  const errors = validateBlockTree(tree);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'leaf_has_children');
  assert.deepEqual(errors[0].path, ['s_card']);
});

test('PREDICTABLE: the walk is recursive — a deep violation reports its full path', () => {
  // A (future) nested container: a grid whose card wrongly holds a child.
  const tree: BlockNode = {
    id: 's_grid',
    type: 'content_grid',
    children: [
      {
        id: 's_card0',
        type: 'card',
        data: { title: 'leaf with an illegal child' },
        children: [{ id: 's_deep', type: 'card', data: { title: 'too deep' } }],
      },
    ],
  };
  const errors = validateBlockTree(tree);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'leaf_has_children');
  assert.deepEqual(errors[0].path, ['s_grid', 's_card0']);
});
