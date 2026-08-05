import '../../../../sites/drlurie/config/policy-bindings.js'; // registers site providers — handleObjectVerb needs them resolvable (migrate-site.test.ts's precedent)
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { handleObjectVerb, type ObjectVerbStore } from './object-verbs.js';
import { objectRecordKey } from './object-store-keys.js';
import { marginaliaThreadKey } from './marginalia-store-keys.js';
import type { MarginaliaStore } from './marginalia-store.js';
import type { ObjectRecord, Principal } from '../../schema/object-record-v1.js';

// ─── injected-store pattern (agent-learning-patch.test.ts's makeStore)

const makeSiteObjectsStore = (seed: ObjectRecord) => {
  const blobs = new Map<string, string>();
  blobs.set(objectRecordKey(seed.object_type, seed.object_id), JSON.stringify(seed));
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

const makeMarginaliaStore = (): MarginaliaStore & { blobs: Map<string, string> } => {
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

const NOW_MS = Date.parse('2026-08-05T00:00:00.000Z');
const HUMAN_NO_ROLE: Principal = { kind: 'human', id: 'u1', email: 'nobody@example.com' };
const HUMAN_EDITOR: Principal = { kind: 'human', id: 'u2', email: 'editor@example.com' };
const AGENT: Principal = { kind: 'agent', agent_name: 'copy-agent', auth: 'publish_key' };
const EDITOR_ROLES = ['editor'] as const;

const makeRecord = (overrides: Partial<ObjectRecord> = {}): ObjectRecord => ({
  object_id: 'page_test1',
  object_type: 'page',
  schema_version: 'page.v1',
  site: 'site_drlurie',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  status: 'active',
  body: { route: '/test-page', pageType: 'standard', title: 'Home', seo: { description: 'x' }, sections: [] },
  publication: { published_time: null },
  history: [],
  version: 1,
  content_revision: 4,
  ...overrides,
});

describe('handleObjectVerb — marginalia_create', () => {
  it('creates a thread anchored to a section, attributing the caller and the object content_revision', async () => {
    const record = makeRecord();
    const store = makeSiteObjectsStore(record);
    const marginaliaStore = makeMarginaliaStore();
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      {
        action: 'marginalia_create',
        object_type: 'page',
        object_id: 'page_test1',
        section_id: 's_hero',
        body: 'This reads oddly on mobile.',
      },
      HUMAN_EDITOR,
      { nowMs: NOW_MS, roles: EDITOR_ROLES, marginaliaStore }
    );
    assert.strictEqual(result.status, 200, JSON.stringify(result.body));
    const thread = (result.body as { thread: Record<string, unknown> }).thread;
    assert.strictEqual((thread.anchor as Record<string, unknown>).sectionId, 's_hero');
    assert.strictEqual(thread.status, 'open');
    assert.deepStrictEqual(thread.created_by, HUMAN_EDITOR);
    const comments = thread.comments as Array<Record<string, unknown>>;
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0]!.body, 'This reads oddly on mobile.');
    assert.strictEqual(comments[0]!.at_content_revision, 4);
    assert.deepStrictEqual(comments[0]!.author, HUMAN_EDITOR);

    // Actually persisted in the marginalia store, not the object store.
    assert.strictEqual(marginaliaStore.blobs.size > 0, true);
    assert.strictEqual(store.blobs.has(objectRecordKey('page', 'page_test1')), true);
    assert.strictEqual(
      JSON.parse(store.blobs.get(objectRecordKey('page', 'page_test1'))!).version,
      1,
      'no lock/version bump — no lock was ever required'
    );
  });

  it('rejects a human with no configured role (403), and writes nothing', async () => {
    const record = makeRecord();
    const store = makeSiteObjectsStore(record);
    const marginaliaStore = makeMarginaliaStore();
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      { action: 'marginalia_create', object_type: 'page', object_id: 'page_test1', body: 'hi' },
      HUMAN_NO_ROLE,
      { nowMs: NOW_MS, roles: [], marginaliaStore }
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(marginaliaStore.blobs.size, 0);
  });

  it('allows any agent principal with no configured roles at all', async () => {
    const record = makeRecord();
    const store = makeSiteObjectsStore(record);
    const marginaliaStore = makeMarginaliaStore();
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      { action: 'marginalia_create', object_type: 'page', object_id: 'page_test1', body: 'agent note' },
      AGENT,
      { nowMs: NOW_MS, marginaliaStore } // no roles at all
    );
    assert.strictEqual(result.status, 200, JSON.stringify(result.body));
  });

  it('404s when the object does not exist', async () => {
    const store = makeSiteObjectsStore(makeRecord());
    const marginaliaStore = makeMarginaliaStore();
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      { action: 'marginalia_create', object_type: 'page', object_id: 'page_does_not_exist', body: 'hi' },
      HUMAN_EDITOR,
      { nowMs: NOW_MS, roles: EDITOR_ROLES, marginaliaStore }
    );
    assert.strictEqual(result.status, 404);
  });

  it('500s with a clear message when the endpoint forgot to wire a marginaliaStore', async () => {
    const store = makeSiteObjectsStore(makeRecord());
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      { action: 'marginalia_create', object_type: 'page', object_id: 'page_test1', body: 'hi' },
      HUMAN_EDITOR,
      { nowMs: NOW_MS, roles: EDITOR_ROLES } // no marginaliaStore
    );
    assert.strictEqual(result.status, 500);
  });

  it('rejects an empty body at the request-schema layer (zod), before the handler ever runs', async () => {
    const { objectVerbRequestSchema } = await import('./object-verbs.js');
    const parsed = objectVerbRequestSchema.safeParse({
      action: 'marginalia_create',
      object_type: 'page',
      object_id: 'page_test1',
      body: '',
    });
    assert.strictEqual(parsed.success, false);
  });
});

describe('handleObjectVerb — marginalia_reply', () => {
  it('adds a comment to an existing thread', async () => {
    const store = makeSiteObjectsStore(makeRecord());
    const marginaliaStore = makeMarginaliaStore();
    const created = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      { action: 'marginalia_create', object_type: 'page', object_id: 'page_test1', body: 'first' },
      HUMAN_EDITOR,
      { nowMs: NOW_MS, roles: EDITOR_ROLES, marginaliaStore }
    );
    const threadId = (created.body as { thread: { id: string } }).thread.id;

    const reply = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      { action: 'marginalia_reply', object_type: 'page', object_id: 'page_test1', thread_id: threadId, body: 'agreed' },
      AGENT,
      { nowMs: NOW_MS + 1000, marginaliaStore }
    );
    assert.strictEqual(reply.status, 200, JSON.stringify(reply.body));
    assert.strictEqual((reply.body as { comment: { body: string } }).comment.body, 'agreed');
  });

  it('404s for an unknown thread_id', async () => {
    const store = makeSiteObjectsStore(makeRecord());
    const marginaliaStore = makeMarginaliaStore();
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      {
        action: 'marginalia_reply',
        object_type: 'page',
        object_id: 'page_test1',
        thread_id: 'mgt_missing',
        body: 'x',
      },
      HUMAN_EDITOR,
      { nowMs: NOW_MS, roles: EDITOR_ROLES, marginaliaStore }
    );
    assert.strictEqual(result.status, 404);
  });

  it('rejects a human with no configured role', async () => {
    const store = makeSiteObjectsStore(makeRecord());
    const marginaliaStore = makeMarginaliaStore();
    await marginaliaStore.setJSON(marginaliaThreadKey('page', 'page_test1', 'mgt_seed'), {
      id: 'mgt_seed',
      anchor: { objectType: 'page', objectId: 'page_test1' },
      status: 'open',
      created_at: '2026-08-05T00:00:00.000Z',
      created_by: HUMAN_EDITOR,
    });
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      {
        action: 'marginalia_reply',
        object_type: 'page',
        object_id: 'page_test1',
        thread_id: 'mgt_seed',
        body: 'x',
      },
      HUMAN_NO_ROLE,
      { nowMs: NOW_MS, roles: [], marginaliaStore }
    );
    assert.strictEqual(result.status, 403);
  });
});

describe('handleObjectVerb — marginalia_list', () => {
  it('is readable with no role/agent gate at all — a bare human with zero roles can list', async () => {
    const store = makeSiteObjectsStore(makeRecord());
    const marginaliaStore = makeMarginaliaStore();
    await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      { action: 'marginalia_create', object_type: 'page', object_id: 'page_test1', body: 'first' },
      HUMAN_EDITOR,
      { nowMs: NOW_MS, roles: EDITOR_ROLES, marginaliaStore }
    );
    const listed = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      { action: 'marginalia_list', object_type: 'page', object_id: 'page_test1' },
      HUMAN_NO_ROLE,
      { nowMs: NOW_MS, roles: [], marginaliaStore }
    );
    assert.strictEqual(listed.status, 200, JSON.stringify(listed.body));
    assert.strictEqual((listed.body as { threads: unknown[] }).threads.length, 1);
  });

  it('returns an empty list for an object with no threads yet, never 404s', async () => {
    const store = makeSiteObjectsStore(makeRecord());
    const marginaliaStore = makeMarginaliaStore();
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      { action: 'marginalia_list', object_type: 'page', object_id: 'page_test1' },
      HUMAN_NO_ROLE,
      { nowMs: NOW_MS, roles: [], marginaliaStore }
    );
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual((result.body as { threads: unknown[] }).threads, []);
  });
});

describe('handleObjectVerb — marginalia_resolve', () => {
  it('sets a thread to resolved, then back to open — no ratchet', async () => {
    const store = makeSiteObjectsStore(makeRecord());
    const marginaliaStore = makeMarginaliaStore();
    const created = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      { action: 'marginalia_create', object_type: 'page', object_id: 'page_test1', body: 'first' },
      HUMAN_EDITOR,
      { nowMs: NOW_MS, roles: EDITOR_ROLES, marginaliaStore }
    );
    const threadId = (created.body as { thread: { id: string } }).thread.id;

    const resolved = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      {
        action: 'marginalia_resolve',
        object_type: 'page',
        object_id: 'page_test1',
        thread_id: threadId,
        status: 'resolved',
      },
      HUMAN_EDITOR,
      { nowMs: NOW_MS, roles: EDITOR_ROLES, marginaliaStore }
    );
    assert.strictEqual(resolved.status, 200);
    assert.strictEqual((resolved.body as { thread: { status: string } }).thread.status, 'resolved');

    const reopened = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      {
        action: 'marginalia_resolve',
        object_type: 'page',
        object_id: 'page_test1',
        thread_id: threadId,
        status: 'open',
      },
      AGENT,
      { nowMs: NOW_MS, marginaliaStore }
    );
    assert.strictEqual(reopened.status, 200);
    assert.strictEqual((reopened.body as { thread: { status: string } }).thread.status, 'open');
  });

  it('rejects an invalid status at the request-schema layer', async () => {
    const { objectVerbRequestSchema } = await import('./object-verbs.js');
    const parsed = objectVerbRequestSchema.safeParse({
      action: 'marginalia_resolve',
      object_type: 'page',
      object_id: 'page_test1',
      thread_id: 'mgt_1',
      status: 'closed', // not one of open | resolved | dismissed
    });
    assert.strictEqual(parsed.success, false);
  });

  it('rejects a human with no configured role', async () => {
    const store = makeSiteObjectsStore(makeRecord());
    const marginaliaStore = makeMarginaliaStore();
    const created = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      { action: 'marginalia_create', object_type: 'page', object_id: 'page_test1', body: 'first' },
      HUMAN_EDITOR,
      { nowMs: NOW_MS, roles: EDITOR_ROLES, marginaliaStore }
    );
    const threadId = (created.body as { thread: { id: string } }).thread.id;
    const result = await handleObjectVerb(
      store as unknown as ObjectVerbStore,
      {
        action: 'marginalia_resolve',
        object_type: 'page',
        object_id: 'page_test1',
        thread_id: threadId,
        status: 'resolved',
      },
      HUMAN_NO_ROLE,
      { nowMs: NOW_MS, roles: [], marginaliaStore }
    );
    assert.strictEqual(result.status, 403);
  });
});
