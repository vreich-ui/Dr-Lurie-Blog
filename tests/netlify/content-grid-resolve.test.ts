/**
 * T3.3 / M-8 — content_grid manual-primary + query-fallback resolution
 * semantics (src/lib/renderer/resolve-content-grid.ts), pinned to the
 * brief's verify criteria: manual 5/limit 5 runs no query; manual 2/limit 5
 * backfills 3 without duplicates; manual 0 is pure fallback; an unresolved
 * manual ref is SKIPPED with a loud warning (changed 2026-07-11 under the
 * no-pipeline-dead-ends rule — a post deleted after the grid published must
 * never kill builds; write-time validation owns rejection). Plus: no
 * fallback declared → short grid, no query; validation rejects unknown
 * fallback-query terms.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeValidation, validateObject } from '../../netlify/lib/object-validate.js';
import { resolveContentGridCards } from '../../src/lib/renderer/resolve-content-grid.js';
import type { ContentQuery } from '../../src/schema/bodies/section-v1.js';

type Card = { id: string; title: string };

const card = (id: string): Card => ({ id, title: `Title of ${id}` });

const PUBLISHED = new Map<string, Card>([
  ['req_a', card('req_a')],
  ['req_b', card('req_b')],
  ['req_c', card('req_c')],
  ['req_d', card('req_d')],
  ['req_e', card('req_e')],
]);
const QUERY_RESULTS: Card[] = [card('req_a'), card('req_q1'), card('req_q2'), card('req_q3'), card('req_q4')];

const makeResolvers = () => {
  const queries: ContentQuery[] = [];
  return {
    queries,
    resolvers: {
      resolveManualItem: (objectId: string) => PUBLISHED.get(objectId),
      runQuery: (query: ContentQuery, limit: number) => {
        queries.push(query);
        return QUERY_RESULTS.slice(0, limit);
      },
      idOf: (item: Card) => item.id,
    },
  };
};

test('manual 5 / limit 5: all five picked in order, NO query executed', () => {
  const { queries, resolvers } = makeResolvers();
  const cards = resolveContentGridCards(
    { kind: 'manual', items: ['req_a', 'req_b', 'req_c', 'req_d', 'req_e'], fallback: { kind: 'query', query: {} } },
    5,
    resolvers
  );
  assert.deepEqual(
    cards.map((item) => item.id),
    ['req_a', 'req_b', 'req_c', 'req_d', 'req_e']
  );
  assert.equal(queries.length, 0, 'a full manual list must not execute the fallback query');
});

test('manual 2 / limit 5: three backfilled from the fallback, manual dupes dropped, manual first', () => {
  const { queries, resolvers } = makeResolvers();
  const cards = resolveContentGridCards(
    { kind: 'manual', items: ['req_a', 'req_b'], fallback: { kind: 'query', query: { sort: 'published_time_desc' } } },
    5,
    resolvers
  );
  // req_a appears in the query results too and must not repeat.
  assert.deepEqual(
    cards.map((item) => item.id),
    ['req_a', 'req_b', 'req_q1', 'req_q2', 'req_q3']
  );
  assert.equal(queries.length, 1);
});

test('manual 0: pure fallback up to limit', () => {
  const { resolvers } = makeResolvers();
  const cards = resolveContentGridCards(
    { kind: 'manual', items: [], fallback: { kind: 'query', query: {} } },
    3,
    resolvers
  );
  assert.deepEqual(
    cards.map((item) => item.id),
    ['req_a', 'req_q1', 'req_q2']
  );
});

test('no fallback declared: a short manual list stays short — no query runs', () => {
  const { queries, resolvers } = makeResolvers();
  const cards = resolveContentGridCards({ kind: 'manual', items: ['req_b'] }, 5, resolvers);
  assert.deepEqual(
    cards.map((item) => item.id),
    ['req_b']
  );
  assert.equal(queries.length, 0);
});

test('an unresolved manual ref is SKIPPED with a loud warning naming it — never fatal', () => {
  const { resolvers } = makeResolvers();
  const warnings: string[] = [];
  const cards = resolveContentGridCards({ kind: 'manual', items: ['req_a', 'req_ghost'] }, 5, resolvers, (message) =>
    warnings.push(message)
  );
  assert.deepEqual(
    cards.map((item) => item.id),
    ['req_a'],
    'the resolvable pick still renders'
  );
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('req_ghost'), warnings[0]);
});

test('a skipped manual ref frees room the declared fallback backfills', () => {
  const { resolvers, queries } = makeResolvers();
  const warnings: string[] = [];
  const cards = resolveContentGridCards(
    { kind: 'manual', items: ['req_b', 'req_ghost'], fallback: { kind: 'query', query: {} } },
    3,
    resolvers,
    (message) => warnings.push(message)
  );
  assert.deepEqual(
    cards.map((item) => item.id),
    ['req_b', 'req_a', 'req_q1'],
    'ghost skipped, backfill fills to limit, no duplicates'
  );
  assert.equal(queries.length, 1);
  assert.equal(warnings.length, 1);
});

test('plain query source: capped at limit, no manual machinery involved', () => {
  const { resolvers } = makeResolvers();
  const cards = resolveContentGridCards({ kind: 'query', query: {} }, 2, resolvers);
  assert.deepEqual(
    cards.map((item) => item.id),
    ['req_a', 'req_q1']
  );
});

test('validation rejects a fallback query naming an unknown taxonomy term', () => {
  const body = {
    route: '/x',
    pageType: 'standard',
    title: 'X',
    seo: { description: 'x' },
    sections: [
      {
        id: 's_grid',
        type: 'content_grid',
        data: {
          source: { kind: 'manual', items: [], fallback: { kind: 'query', query: { category: 't_ghost' } } },
          limit: 4,
        },
      },
    ],
  };
  const groups = validateObject(
    { objectType: 'page', objectId: 'page_x', body },
    { resolveTaxonomyTerm: () => undefined }
  );
  const summary = summarizeValidation(groups);
  assert.ok(
    summary.blockers.some((blocker) => JSON.stringify(blocker).includes('content_grid fallback query')),
    JSON.stringify(summary.blockers)
  );
});
