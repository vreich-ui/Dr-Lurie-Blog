import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  addMarginaliaComment,
  createMarginaliaThread,
  listMarginaliaThreads,
  setMarginaliaThreadStatus,
  type MarginaliaStore,
} from './marginalia-store.js';
import type { Principal } from '../../schema/object-record-v1.js';

// ─── injected-store pattern (agent-learning-patch.test.ts's makeStore) ───────

const makeStore = (): MarginaliaStore & { blobs: Map<string, string> } => {
  const blobs = new Map<string, string>();
  return {
    blobs,
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async setJSON(key: string, value: unknown) {
      blobs.set(key, JSON.stringify(value));
    },
    async list({ prefix }: { prefix: string }) {
      return { blobs: [...blobs.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
};

const HUMAN: Principal = { kind: 'human', id: 'u1', email: 'editor@example.com' };
const AGENT: Principal = { kind: 'agent', agent_name: 'copy-agent', auth: 'publish_key' };

describe('createMarginaliaThread', () => {
  it('writes a thread header, its first comment, and an index marker, all listable', async () => {
    const store = makeStore();
    const { thread, comment } = await createMarginaliaThread(store, {
      objectType: 'page',
      objectId: 'page_home',
      anchor: { sectionId: 's_hero' },
      body: 'This headline reads oddly on mobile.',
      author: HUMAN,
      at: '2026-08-05T00:00:00.000Z',
      contentRevision: 3,
    });

    assert.strictEqual(thread.status, 'open');
    assert.strictEqual(thread.anchor.objectType, 'page');
    assert.strictEqual(thread.anchor.objectId, 'page_home');
    assert.strictEqual(thread.anchor.sectionId, 's_hero');
    assert.deepStrictEqual(thread.created_by, HUMAN);
    assert.strictEqual(comment.body, 'This headline reads oddly on mobile.');
    assert.strictEqual(comment.at_content_revision, 3);
    assert.deepStrictEqual(comment.author, HUMAN);

    const listed = await listMarginaliaThreads(store, 'page', 'page_home');
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0]!.id, thread.id);
    assert.strictEqual(listed[0]!.comments.length, 1);
    assert.strictEqual(listed[0]!.comments[0]!.id, comment.id);
  });

  it('mints distinct ids across two threads when none is injected', async () => {
    const store = makeStore();
    const a = await createMarginaliaThread(store, {
      objectType: 'page',
      objectId: 'page_home',
      anchor: {},
      body: 'first',
      author: HUMAN,
      at: '2026-08-05T00:00:00.000Z',
      contentRevision: 1,
    });
    const b = await createMarginaliaThread(store, {
      objectType: 'page',
      objectId: 'page_home',
      anchor: {},
      body: 'second',
      author: HUMAN,
      at: '2026-08-05T00:00:01.000Z',
      contentRevision: 1,
    });
    assert.notStrictEqual(a.thread.id, b.thread.id);
    assert.notStrictEqual(a.comment.id, b.comment.id);
  });

  it('omits unset anchor fields entirely rather than writing them as undefined', async () => {
    const store = makeStore();
    const { thread } = await createMarginaliaThread(store, {
      objectType: 'site',
      objectId: 'site_acme',
      anchor: {},
      body: 'Whole-object comment.',
      author: AGENT,
      at: '2026-08-05T00:00:00.000Z',
      contentRevision: 1,
    });
    assert.strictEqual('sectionId' in thread.anchor, false);
    assert.strictEqual('nodeId' in thread.anchor, false);
  });
});

describe('addMarginaliaComment', () => {
  it('appends a comment to an existing thread', async () => {
    const store = makeStore();
    const { thread } = await createMarginaliaThread(store, {
      objectType: 'page',
      objectId: 'page_home',
      anchor: {},
      body: 'first',
      author: HUMAN,
      at: '2026-08-05T00:00:00.000Z',
      contentRevision: 1,
    });
    const result = await addMarginaliaComment(store, {
      objectType: 'page',
      objectId: 'page_home',
      threadId: thread.id,
      body: 'Agreed, fixing now.',
      author: AGENT,
      at: '2026-08-05T00:05:00.000Z',
      contentRevision: 1,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.ok && result.comment.body, 'Agreed, fixing now.');

    const listed = await listMarginaliaThreads(store, 'page', 'page_home');
    assert.strictEqual(listed[0]!.comments.length, 2);
    // Oldest first.
    assert.strictEqual(listed[0]!.comments[0]!.body, 'first');
    assert.strictEqual(listed[0]!.comments[1]!.body, 'Agreed, fixing now.');
  });

  it('reports thread_not_found for a nonexistent thread id, writing nothing', async () => {
    const store = makeStore();
    const result = await addMarginaliaComment(store, {
      objectType: 'page',
      objectId: 'page_home',
      threadId: 'mgt_does_not_exist',
      body: 'x',
      author: HUMAN,
      at: '2026-08-05T00:00:00.000Z',
      contentRevision: 1,
    });
    assert.deepStrictEqual(result, { ok: false, error: 'thread_not_found' });
    assert.strictEqual(store.blobs.size, 0);
  });

  it('stores parentCommentId only when supplied', async () => {
    const store = makeStore();
    const { thread } = await createMarginaliaThread(store, {
      objectType: 'page',
      objectId: 'page_home',
      anchor: {},
      body: 'first',
      author: HUMAN,
      at: '2026-08-05T00:00:00.000Z',
      contentRevision: 1,
    });
    const withParent = await addMarginaliaComment(store, {
      objectType: 'page',
      objectId: 'page_home',
      threadId: thread.id,
      body: 'reply',
      author: HUMAN,
      at: '2026-08-05T00:01:00.000Z',
      contentRevision: 1,
      parentCommentId: 'mgc_root',
    });
    assert.strictEqual(withParent.ok && withParent.comment.parentCommentId, 'mgc_root');
  });
});

describe('listMarginaliaThreads', () => {
  it('returns an empty array for an object with no threads', async () => {
    const store = makeStore();
    const listed = await listMarginaliaThreads(store, 'page', 'page_nowhere');
    assert.deepStrictEqual(listed, []);
  });

  it('never mixes threads across two different objects sharing a store', async () => {
    const store = makeStore();
    await createMarginaliaThread(store, {
      objectType: 'page',
      objectId: 'page_a',
      anchor: {},
      body: 'on page a',
      author: HUMAN,
      at: '2026-08-05T00:00:00.000Z',
      contentRevision: 1,
    });
    await createMarginaliaThread(store, {
      objectType: 'page',
      objectId: 'page_b',
      anchor: {},
      body: 'on page b',
      author: HUMAN,
      at: '2026-08-05T00:00:00.000Z',
      contentRevision: 1,
    });
    const onA = await listMarginaliaThreads(store, 'page', 'page_a');
    const onB = await listMarginaliaThreads(store, 'page', 'page_b');
    assert.strictEqual(onA.length, 1);
    assert.strictEqual(onA[0]!.comments[0]!.body, 'on page a');
    assert.strictEqual(onB.length, 1);
    assert.strictEqual(onB[0]!.comments[0]!.body, 'on page b');
  });

  it('orders threads oldest-created-first', async () => {
    const store = makeStore();
    await createMarginaliaThread(store, {
      objectType: 'page',
      objectId: 'page_home',
      anchor: {},
      body: 'later',
      author: HUMAN,
      at: '2026-08-05T00:10:00.000Z',
      contentRevision: 1,
    });
    await createMarginaliaThread(store, {
      objectType: 'page',
      objectId: 'page_home',
      anchor: {},
      body: 'earlier',
      author: HUMAN,
      at: '2026-08-05T00:00:00.000Z',
      contentRevision: 1,
    });
    const listed = await listMarginaliaThreads(store, 'page', 'page_home');
    assert.deepStrictEqual(
      listed.map((t) => t.comments[0]!.body),
      ['earlier', 'later']
    );
  });
});

describe('setMarginaliaThreadStatus', () => {
  it('resolves an open thread and the change is visible on a subsequent list', async () => {
    const store = makeStore();
    const { thread } = await createMarginaliaThread(store, {
      objectType: 'page',
      objectId: 'page_home',
      anchor: {},
      body: 'first',
      author: HUMAN,
      at: '2026-08-05T00:00:00.000Z',
      contentRevision: 1,
    });
    const result = await setMarginaliaThreadStatus(store, {
      objectType: 'page',
      objectId: 'page_home',
      threadId: thread.id,
      status: 'resolved',
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.ok && result.thread.status, 'resolved');
    const listed = await listMarginaliaThreads(store, 'page', 'page_home');
    assert.strictEqual(listed[0]!.status, 'resolved');
  });

  it('re-opening a dismissed thread works — one status flag, no ratchet', async () => {
    const store = makeStore();
    const { thread } = await createMarginaliaThread(store, {
      objectType: 'page',
      objectId: 'page_home',
      anchor: {},
      body: 'first',
      author: HUMAN,
      at: '2026-08-05T00:00:00.000Z',
      contentRevision: 1,
    });
    await setMarginaliaThreadStatus(store, {
      objectType: 'page',
      objectId: 'page_home',
      threadId: thread.id,
      status: 'dismissed',
    });
    const reopened = await setMarginaliaThreadStatus(store, {
      objectType: 'page',
      objectId: 'page_home',
      threadId: thread.id,
      status: 'open',
    });
    assert.strictEqual(reopened.ok && reopened.thread.status, 'open');
  });

  it('reports thread_not_found for a nonexistent thread id', async () => {
    const store = makeStore();
    const result = await setMarginaliaThreadStatus(store, {
      objectType: 'page',
      objectId: 'page_home',
      threadId: 'mgt_missing',
      status: 'resolved',
    });
    assert.deepStrictEqual(result, { ok: false, error: 'thread_not_found' });
  });
});
