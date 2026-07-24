import { describe, it } from 'node:test';
import assert from 'node:assert';

import { statusTone, sortRows, filterCommands, relativeTimeFromNow } from './logic.js';

describe('statusTone', () => {
  it('maps readiness statuses', () => {
    assert.strictEqual(statusTone('complete'), 'success');
    assert.strictEqual(statusTone('warning'), 'warning');
    assert.strictEqual(statusTone('missing'), 'danger');
    assert.strictEqual(statusTone('optional'), 'neutral');
  });
  it('maps lifecycle words and unknowns', () => {
    assert.strictEqual(statusTone('published'), 'success');
    assert.strictEqual(statusTone('changes_requested'), 'warning');
    assert.strictEqual(statusTone('failed'), 'danger');
    assert.strictEqual(statusTone('whatever'), 'neutral');
  });
});

describe('sortRows', () => {
  const rows = [
    { n: 'Beta', v: 2 },
    { n: 'alpha', v: 10 },
    { n: 'Gamma', v: 2 },
  ];

  it('sorts strings ascending, case-insensitive', () => {
    assert.deepStrictEqual(
      sortRows(rows, (r) => r.n, 'asc').map((r) => r.n),
      ['alpha', 'Beta', 'Gamma']
    );
  });

  it('sorts numbers descending', () => {
    assert.deepStrictEqual(
      sortRows(rows, (r) => r.v, 'desc').map((r) => r.v),
      [10, 2, 2]
    );
  });

  it('is stable on ties (Beta before Gamma, both v=2)', () => {
    assert.deepStrictEqual(
      sortRows(rows, (r) => r.v, 'asc').map((r) => r.n),
      ['Beta', 'Gamma', 'alpha']
    );
  });

  it('sinks nullish/empty values to the end regardless of direction', () => {
    const withGaps = [{ x: 'b' }, { x: undefined }, { x: 'a' }];
    assert.deepStrictEqual(
      sortRows(withGaps, (r) => r.x, 'asc').map((r) => r.x),
      ['a', 'b', undefined]
    );
    assert.deepStrictEqual(
      sortRows(withGaps, (r) => r.x, 'desc').map((r) => r.x),
      ['b', 'a', undefined]
    );
  });

  it('does not mutate the input', () => {
    const input = [{ v: 3 }, { v: 1 }];
    sortRows(input, (r) => r.v, 'asc');
    assert.deepStrictEqual(
      input.map((r) => r.v),
      [3, 1]
    );
  });
});

describe('filterCommands', () => {
  const cmds = [
    { id: '1', label: 'Publish article' },
    { id: '2', label: 'Create page' },
    { id: '3', label: 'Republish draft' },
    { id: '4', label: 'Archive item', keywords: ['delete', 'remove'] },
  ];

  it('returns all for an empty query, original order', () => {
    assert.deepStrictEqual(
      filterCommands(cmds, '   ').map((c) => c.id),
      ['1', '2', '3', '4']
    );
  });

  it('ranks label prefix above substring', () => {
    // "pub" → "Publish article" (prefix, rank 0) before "Republish draft" (substring, rank 2)
    assert.deepStrictEqual(
      filterCommands(cmds, 'pub').map((c) => c.id),
      ['1', '3']
    );
  });

  it('matches keywords when the label does not', () => {
    assert.deepStrictEqual(
      filterCommands(cmds, 'delete').map((c) => c.id),
      ['4']
    );
  });

  it('excludes non-matches', () => {
    assert.deepStrictEqual(filterCommands(cmds, 'zzz'), []);
  });
});

describe('relativeTimeFromNow', () => {
  const now = Date.parse('2026-07-17T12:00:00.000Z');

  it('phrases recent spans', () => {
    assert.strictEqual(relativeTimeFromNow('2026-07-17T11:59:40.000Z', now), 'just now');
    assert.strictEqual(relativeTimeFromNow('2026-07-17T11:55:00.000Z', now), '5m ago');
    assert.strictEqual(relativeTimeFromNow('2026-07-17T09:00:00.000Z', now), '3h ago');
    assert.strictEqual(relativeTimeFromNow('2026-07-15T12:00:00.000Z', now), '2d ago');
  });

  it('treats future timestamps as just now (clock skew)', () => {
    assert.strictEqual(relativeTimeFromNow('2026-07-17T12:03:00.000Z', now), 'just now');
  });

  it('is empty for missing/invalid input', () => {
    assert.strictEqual(relativeTimeFromNow(undefined, now), '');
    assert.strictEqual(relativeTimeFromNow('not-a-date', now), '');
  });
});
