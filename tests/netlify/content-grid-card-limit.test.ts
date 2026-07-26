/**
 * content_grid cards-vs-limit warning (netlify/lib/object-validate.ts). A
 * `cards`-source grid with more cells than `limit` silently truncates at render
 * (ContentGrid.astro slices to `limit`), so an agent editing a beyond-limit cell
 * sees no change. Validation surfaces this as a WARNING (never a blocker — a
 * short render is legal), for both page bodies and shared `section` wrappers.
 */
import '../../sites/drlurie/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkContentGridCardLimits, summarizeValidation, validateObject } from '../../packages/core/server/lib/object-validate.js';

const gridSection = (cardCount: number, limit: number) => ({
  section: {
    id: 's_grid',
    type: 'content_grid',
    data: {
      heading: 'Grid',
      source: { kind: 'cards', cards: Array.from({ length: cardCount }, (_, i) => ({ title: `Card ${i + 1}` })) },
      limit,
    },
  },
});

test('warns when a cards grid has more cells than limit', () => {
  const criteria = checkContentGridCardLimits(gridSection(6, 4));
  assert.equal(criteria.length, 1);
  assert.equal(criteria[0].id, 'content_grid_card_limit');
  assert.equal(criteria[0].status, 'warning');
  assert.match(criteria[0].message, /2 will not render/);
});

test('complete when a cards grid fits within limit', () => {
  const criteria = checkContentGridCardLimits(gridSection(4, 4));
  assert.equal(criteria.length, 1);
  assert.equal(criteria[0].status, 'complete');
});

test('a query-source grid never warns (no cards to truncate)', () => {
  const body = {
    section: {
      id: 's_grid',
      type: 'content_grid',
      data: { heading: 'Grid', source: { kind: 'query', query: { sort: 'published_time_desc' } }, limit: 3 },
    },
  };
  const criteria = checkContentGridCardLimits(body);
  assert.equal(criteria[0].status, 'complete');
});

test('bodies with no content_grid emit no card-limit criterion', () => {
  assert.deepEqual(
    checkContentGridCardLimits({ section: { id: 's_p', type: 'prose', data: { body: '<p>x</p>' } } }),
    []
  );
});

test('the overflow surfaces as a WARNING in the full validation, never a blocker', () => {
  const summary = summarizeValidation(
    validateObject({ objectType: 'section', objectId: 'sec_overflow', body: gridSection(6, 4) }, {})
  );
  assert.deepEqual(summary.blockers, [], 'card overflow must not block');
  assert.ok(
    summary.warnings.some((criterion) => criterion.id === 'content_grid_card_limit'),
    'card overflow must appear as a warning'
  );
});

test('detects overflow in a page body inline grid too', () => {
  const page = {
    route: '/x',
    pageType: 'standard',
    title: 'X',
    seo: {},
    sections: [
      {
        id: 's_grid',
        type: 'content_grid',
        data: {
          heading: 'G',
          source: { kind: 'cards', cards: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] },
          limit: 2,
        },
      },
    ],
  };
  const criteria = checkContentGridCardLimits(page);
  assert.equal(criteria[0].status, 'warning');
  assert.match(criteria[0].message, /s_grid: 3 cards but limit 2/);
});
