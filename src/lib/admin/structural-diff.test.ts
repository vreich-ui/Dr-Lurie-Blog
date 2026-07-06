import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyPatchOps } from '../object-patch-apply.js';
import { computeStructuralDiff, isStructuralCapture, pendingHistory } from './structural-diff.js';
import type { HistoryEntry, ObjectRecord, Principal } from '../../schema/object-record-v1.js';

const actor: Principal = { kind: 'agent', agent_name: 'codex', auth: 'publish_key' };
const AT = '2026-07-06T00:00:00.000Z';

const navRecord = (): ObjectRecord => ({
  object_id: 'nav_footer',
  object_type: 'navigation',
  schema_version: 'navigation.v1',
  site: 'site_drlurie',
  created_at: AT,
  updated_at: AT,
  status: 'active',
  body: {
    role: 'footer',
    groups: [
      {
        id: 'g_primary',
        items: [
          { id: 'n_privacy', label: 'Privacy', target: { kind: 'external', href: 'https://drlurie.com/privacy' } },
        ],
      },
    ],
  },
  publication: { published_time: null },
  history: [{ at: AT, action: 'object_create', actor }],
  version: 1,
  content_revision: 1,
});

const pageRecord = (): ObjectRecord => ({
  object_id: 'page_home',
  object_type: 'page',
  schema_version: 'page.v1',
  site: 'site_drlurie',
  created_at: AT,
  updated_at: AT,
  status: 'active',
  body: {
    route: '/',
    pageType: 'home',
    title: 'Home',
    seo: {},
    sections: [{ id: 's_hero1', type: 'hero', data: { heading: 'Original', actions: [] } }],
  },
  publication: { published_time: null },
  history: [{ at: AT, action: 'object_create', actor }],
  version: 1,
  content_revision: 1,
});

describe('computeStructuralDiff', () => {
  it('classifies a true insert (upsert_section, no prior element) as added', () => {
    const record = pageRecord();
    const { record: applied } = applyPatchOps(
      record,
      [{ op: 'upsert_section', section: { id: 's_new1', type: 'prose', data: { body: 'New paragraph' } } }],
      { actor, at: AT }
    );

    const diff = computeStructuralDiff(applied.history);
    assert.equal(diff.length, 1);
    assert.equal(diff[0].kind, 'added');
    assert.equal(diff[0].action, 'upsert_section');
    assert.equal(diff[0].label, 'Added section s_new1 (prose)');
    assert.equal(diff[0].before, undefined);
    assert.deepEqual(diff[0].after, { id: 's_new1', type: 'prose', data: { body: 'New paragraph' } });
  });

  it('classifies upsert_section replacing an existing section as replaced (not added)', () => {
    const record = pageRecord();
    const { record: applied } = applyPatchOps(
      record,
      [{ op: 'upsert_section', section: { id: 's_hero1', type: 'hero', data: { heading: 'Rewritten', actions: [] } } }],
      { actor, at: AT }
    );

    const diff = computeStructuralDiff(applied.history);
    assert.equal(diff.length, 1);
    assert.equal(diff[0].kind, 'replaced');
    assert.equal(diff[0].label, 'Replaced section s_hero1 (hero)');
    assert.deepEqual(diff[0].before, { id: 's_hero1', type: 'hero', data: { heading: 'Original', actions: [] } });
  });

  it('classifies remove_section as removed', () => {
    const record = pageRecord();
    const { record: applied } = applyPatchOps(record, [{ op: 'remove_section', section_id: 's_hero1' }], {
      actor,
      at: AT,
    });

    const diff = computeStructuralDiff(applied.history);
    assert.equal(diff.length, 1);
    assert.equal(diff[0].kind, 'removed');
    assert.equal(diff[0].label, 'Removed section s_hero1');
    assert.equal(diff[0].after, undefined);
  });

  it('classifies move_section as moved, with a before/after index label', () => {
    const record = pageRecord();
    const withTwo = applyPatchOps(
      record,
      [{ op: 'upsert_section', section: { id: 's_second', type: 'prose', data: { body: 'Second' } } }],
      { actor, at: AT }
    ).record;
    const { record: moved } = applyPatchOps(withTwo, [{ op: 'move_section', section_id: 's_hero1', to_index: 1 }], {
      actor,
      at: AT,
    });

    const diff = computeStructuralDiff(moved.history);
    const moveEntry = diff.find((entry) => entry.kind === 'moved');
    assert.ok(moveEntry);
    assert.equal(moveEntry?.label, 'Moved section s_hero1 from position 0 to 1');
  });

  it('classifies nav item/group ops (added/removed) with group context in the label', () => {
    const record = navRecord();
    const withItem = applyPatchOps(
      record,
      [
        {
          op: 'upsert_item',
          group_id: 'g_primary',
          item: { id: 'n_terms', label: 'Terms', target: { kind: 'external', href: 'https://drlurie.com/terms' } },
        },
      ],
      { actor, at: AT }
    ).record;
    const { record: removed } = applyPatchOps(
      withItem,
      [{ op: 'remove_item', group_id: 'g_primary', item_id: 'n_privacy' }],
      {
        actor,
        at: AT,
      }
    );

    const diff = computeStructuralDiff(removed.history);
    assert.equal(diff.length, 2);
    assert.equal(diff[0].kind, 'added');
    assert.equal(diff[0].label, 'Added nav item n_terms in group g_primary');
    assert.equal(diff[1].kind, 'removed');
    assert.equal(diff[1].label, 'Removed nav item n_privacy in group g_primary');
  });

  it('classifies add_term as added with kind + slug in the label', () => {
    const record: ObjectRecord = {
      ...navRecord(),
      object_id: 'tax_drlurie',
      object_type: 'taxonomy',
      schema_version: 'taxonomy.v1',
      body: { kinds: { category: { terms: [] }, tag: { terms: [] } } },
    };
    const { record: applied } = applyPatchOps(
      record,
      [
        {
          op: 'add_term',
          kind: 'category',
          term: { term_id: 't_skincare', slug: 'skincare', label: 'Skincare', status: 'active' },
        },
      ],
      { actor, at: AT }
    );

    const diff = computeStructuralDiff(applied.history);
    assert.equal(diff.length, 1);
    assert.equal(diff[0].kind, 'added');
    assert.equal(diff[0].label, 'Added category term t_skincare (skincare)');
  });

  it('excludes field-level ops (update_section_data, deprecate_term) entirely — they belong to surface 1', () => {
    const record = pageRecord();
    const { record: fieldEdited } = applyPatchOps(
      record,
      [{ op: 'update_section_data', section_id: 's_hero1', fields: { heading: 'Edited copy' } }],
      { actor, at: AT }
    );
    assert.deepEqual(computeStructuralDiff(fieldEdited.history), []);

    const taxonomy: ObjectRecord = {
      ...navRecord(),
      object_id: 'tax_drlurie',
      object_type: 'taxonomy',
      schema_version: 'taxonomy.v1',
      body: {
        kinds: {
          category: { terms: [{ term_id: 't_skincare', slug: 'skincare', label: 'Skincare', status: 'active' }] },
          tag: { terms: [] },
        },
      },
    };
    const { record: deprecated } = applyPatchOps(
      taxonomy,
      [{ op: 'deprecate_term', kind: 'category', term_id: 't_skincare' }],
      { actor, at: AT }
    );
    assert.deepEqual(computeStructuralDiff(deprecated.history), []);
  });

  it('skips non-patch history entries (object_create, checkout) without throwing', () => {
    const record = pageRecord();
    const diff = computeStructuralDiff(record.history);
    assert.deepEqual(diff, []);
  });

  it('preserves history order across multiple structural ops, and historyIndex points back correctly', () => {
    const record = pageRecord();
    const { record: applied } = applyPatchOps(
      record,
      [
        { op: 'upsert_section', section: { id: 's_a', type: 'prose', data: { body: 'A' } } },
        { op: 'upsert_section', section: { id: 's_b', type: 'prose', data: { body: 'B' } } },
        { op: 'remove_section', section_id: 's_a' },
      ],
      { actor, at: AT }
    );

    const diff = computeStructuralDiff(applied.history);
    assert.deepEqual(
      diff.map((entry) => entry.kind),
      ['added', 'added', 'removed']
    );
    diff.forEach((entry) => {
      assert.equal(applied.history[entry.historyIndex].action, entry.action);
    });
  });

  it('each entry.entry carries exactly the {op, capture} the history stores, ready for the discard verb', () => {
    const record = pageRecord();
    const { record: applied } = applyPatchOps(record, [{ op: 'remove_section', section_id: 's_hero1' }], {
      actor,
      at: AT,
    });

    const diff = computeStructuralDiff(applied.history);
    const stored = applied.history[applied.history.length - 1].details as { op: unknown; capture: unknown };
    assert.deepEqual(diff[0].entry, stored);
  });
});

describe('isStructuralCapture', () => {
  it('is true for element and move captures, false for fields', () => {
    assert.equal(isStructuralCapture({ kind: 'element' }), true);
    assert.equal(isStructuralCapture({ kind: 'move' }), true);
    assert.equal(isStructuralCapture({ kind: 'fields' }), false);
  });
});

describe('pendingHistory', () => {
  const entry = (action: string): HistoryEntry => ({ at: AT, action, actor });

  it('returns the whole history when no review_decide has ever happened', () => {
    const history = [entry('object_create'), entry('checkout'), entry('upsert_section')];
    assert.deepEqual(pendingHistory(history), history);
  });

  it('returns only entries after the most recent review_decide', () => {
    const history = [
      entry('object_create'),
      entry('upsert_section'), // pre-decision proposal, already decided
      entry('review_decide'), // request_changes or approve
      entry('checkin'),
      entry('checkout'),
      entry('update_section_data'), // new work since the decision
    ];
    const pending = pendingHistory(history);
    assert.deepEqual(
      pending.map((e) => e.action),
      ['checkin', 'checkout', 'update_section_data']
    );
  });

  it('uses the LAST review_decide when there have been several review cycles', () => {
    const history = [
      entry('review_decide'),
      entry('update_section_data'),
      entry('review_decide'),
      entry('upsert_section'),
    ];
    const pending = pendingHistory(history);
    assert.deepEqual(
      pending.map((e) => e.action),
      ['upsert_section']
    );
  });
});
