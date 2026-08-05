import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  describeMarginaliaAnchor,
  marginaliaStatusLabel,
  nextMarginaliaResolveAction,
  resolveComposerAction,
} from './marginalia-panel.js';
import type { MarginaliaThreadWithComments } from '../../schema/marginalia-v1.js';
import type { Principal } from '../../schema/object-record-v1.js';

const HUMAN: Principal = { kind: 'human', id: 'u1', email: 'editor@example.com' };

const thread = (overrides: Partial<MarginaliaThreadWithComments>): MarginaliaThreadWithComments => ({
  id: 'mgt_1',
  anchor: { objectType: 'page', objectId: 'page_home' },
  status: 'open',
  created_at: '2026-08-05T00:00:00.000Z',
  created_by: HUMAN,
  comments: [],
  ...overrides,
});

describe('describeMarginaliaAnchor', () => {
  it('names a section anchor', () => {
    assert.strictEqual(describeMarginaliaAnchor({ sectionId: 's_hero' }), 'Section s_hero');
  });
  it('names a node anchor', () => {
    assert.strictEqual(describeMarginaliaAnchor({ nodeId: 'n_intro' }), 'Node n_intro');
  });
  it('a section id wins over a node id when (implausibly) both are present', () => {
    assert.strictEqual(describeMarginaliaAnchor({ sectionId: 's_hero', nodeId: 'n_intro' }), 'Section s_hero');
  });
  it('falls back to whole-object when neither is set', () => {
    assert.strictEqual(describeMarginaliaAnchor({}), 'Whole object');
  });
});

describe('marginaliaStatusLabel', () => {
  it('labels every status', () => {
    assert.strictEqual(marginaliaStatusLabel('open'), 'Open');
    assert.strictEqual(marginaliaStatusLabel('resolved'), 'Resolved');
    assert.strictEqual(marginaliaStatusLabel('dismissed'), 'Dismissed');
  });
});

describe('nextMarginaliaResolveAction', () => {
  it('open → Resolve', () => {
    assert.deepStrictEqual(nextMarginaliaResolveAction('open'), { label: 'Resolve', next: 'resolved' });
  });
  it('resolved → Reopen', () => {
    assert.deepStrictEqual(nextMarginaliaResolveAction('resolved'), { label: 'Reopen', next: 'open' });
  });
  it('dismissed → Reopen', () => {
    assert.deepStrictEqual(nextMarginaliaResolveAction('dismissed'), { label: 'Reopen', next: 'open' });
  });
});

describe('resolveComposerAction', () => {
  const target = { objectType: 'page', objectId: 'page_home', sectionId: 's_hero' };

  it('creates a new thread when none exists yet', () => {
    assert.deepStrictEqual(resolveComposerAction([], target), { kind: 'create' });
  });

  it('replies to the open thread anchored to the exact same section', () => {
    const threads = [
      thread({ id: 'mgt_a', anchor: { objectType: 'page', objectId: 'page_home', sectionId: 's_hero' } }),
    ];
    assert.deepStrictEqual(resolveComposerAction(threads, target), { kind: 'reply', threadId: 'mgt_a' });
  });

  it('creates a new thread when the only existing thread is anchored to a DIFFERENT section', () => {
    const threads = [
      thread({ id: 'mgt_other', anchor: { objectType: 'page', objectId: 'page_home', sectionId: 's_footer' } }),
    ];
    assert.deepStrictEqual(resolveComposerAction(threads, target), { kind: 'create' });
  });

  it('creates a new thread when the anchored one is resolved (not open)', () => {
    const threads = [
      thread({
        id: 'mgt_a',
        status: 'resolved',
        anchor: { objectType: 'page', objectId: 'page_home', sectionId: 's_hero' },
      }),
    ];
    assert.deepStrictEqual(resolveComposerAction(threads, target), { kind: 'create' });
  });

  it('picks the MOST RECENT open thread at this anchor when several exist', () => {
    const threads = [
      thread({ id: 'mgt_first', anchor: { objectType: 'page', objectId: 'page_home', sectionId: 's_hero' } }),
      thread({ id: 'mgt_second', anchor: { objectType: 'page', objectId: 'page_home', sectionId: 's_hero' } }),
    ];
    assert.deepStrictEqual(resolveComposerAction(threads, target), { kind: 'reply', threadId: 'mgt_second' });
  });

  it('a whole-object target (no sectionId/nodeId) matches only whole-object threads', () => {
    const wholeObjectTarget = { objectType: 'site', objectId: 'site_acme' };
    const threads = [thread({ id: 'mgt_whole', anchor: { objectType: 'site', objectId: 'site_acme' } })];
    assert.deepStrictEqual(resolveComposerAction(threads, wholeObjectTarget), { kind: 'reply', threadId: 'mgt_whole' });
  });
});
