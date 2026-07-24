import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeFieldDiffEntries, fieldDiffLeaves, isProseField } from './field-diff.js';
import type { HistoryEntry, Principal } from '../../../packages/core/schema/object-record-v1.js';

const actor: Principal = { kind: 'agent', agent_name: 'codex', auth: 'publish_key' };
const AT = '2026-07-06T00:00:00.000Z';

describe('fieldDiffLeaves', () => {
  it('reports only changed scalar leaves, skipping unchanged and nested fields', () => {
    const leaves = fieldDiffLeaves(
      { heading: 'Old', body: 'Same', nested: { a: 1 } },
      { heading: 'New', body: 'Same', nested: { a: 2 } }
    );
    assert.deepEqual(leaves, [{ field: 'heading', oldValue: 'Old', newValue: 'New' }]);
  });

  it('treats null/undefined as absent for comparison purposes', () => {
    const leaves = fieldDiffLeaves({ ctaLink: null }, { ctaLink: '/start-here' });
    assert.deepEqual(leaves, [{ field: 'ctaLink', oldValue: undefined, newValue: '/start-here' }]);
  });
});

describe('isProseField', () => {
  it('is prose only once either side exceeds the 80-char threshold', () => {
    assert.equal(isProseField('short', 'short2'), false);
    assert.equal(isProseField('x'.repeat(81), 'y'), true);
    assert.equal(isProseField('y', 'x'.repeat(81)), true);
  });
});

describe('computeFieldDiffEntries', () => {
  it('extracts fields-capture history entries and skips element/move ones', () => {
    const history: HistoryEntry[] = [
      { at: AT, action: 'object_create', actor },
      {
        at: AT,
        action: 'update_section_data',
        actor,
        details: { op: {}, capture: { kind: 'fields', before: { heading: 'Old' }, after: { heading: 'New' } } },
      },
      {
        at: AT,
        action: 'upsert_section',
        actor,
        details: {
          op: {},
          capture: { kind: 'element', before: { exists: false }, after: { exists: true, value: {}, index: 0 } },
        },
      },
    ];

    const entries = computeFieldDiffEntries(history);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'update_section_data');
    assert.deepEqual(entries[0].leaves, [{ field: 'heading', oldValue: 'Old', newValue: 'New' }]);
  });

  it('skips fields captures whose leaves are all unchanged (e.g. a no-op edit)', () => {
    const history: HistoryEntry[] = [
      {
        at: AT,
        action: 'update_item',
        actor,
        details: { op: {}, capture: { kind: 'fields', before: { label: 'Same' }, after: { label: 'Same' } } },
      },
    ];
    assert.deepEqual(computeFieldDiffEntries(history), []);
  });
});
