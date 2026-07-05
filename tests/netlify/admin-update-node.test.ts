import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { updateAdminNode } from '../../netlify/functions/admin-update-node.js';

// ---------------------------------------------------------------------------
// In-memory blob store (same shape used by all admin endpoint tests).
// ---------------------------------------------------------------------------
const createMemoryStore = () => {
  const blobs = new Map<string, string>();
  return {
    async set(key: string, value: string) {
      blobs.set(key, value);
    },
    async get(key: string) {
      return blobs.get(key) ?? null;
    },
    async del(key: string) {
      blobs.delete(key);
    },
    async setJSON(key: string, value: unknown) {
      blobs.set(key, JSON.stringify(value));
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? '';
      return {
        blobs: [...blobs.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, etag: '' })),
        directories: [],
      };
    },
  };
};

type Store = ReturnType<typeof createMemoryStore>;
const parseBody = (r: { body: string }) => JSON.parse(r.body) as Record<string, unknown>;

const LOCK_TOKEN = 'tok_update_node_test';
const REQUEST_ID = 'req_test_update_node';
const RECORD_KEY = `workflows/by-id/${REQUEST_ID}.json`;
const ACTOR = { userId: 'admin_1', email: 'admin@example.com' };

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  request_id: REQUEST_ID,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  workflow_status: 'in_progress',
  current_stage: null,
  next_agent: null,
  completed_agents: [],
  failed_agents: [],
  last_error: null,
  needs_review: false,
  input: {
    record_type: 'content_source',
    schema_version: 'content_source.v1',
    content: {
      title: 'Node Update Test',
      article_body: {
        schema_version: 'article_body.v1',
        nodes: [{ id: 'n_hero', kind: 'content', public: { title: 'Original title', body: 'Original body.' } }],
      },
    },
    publication: { schema_version: 'publication.v2', published_time: null },
  },
  agent_outputs: {},
  lock: {
    token: LOCK_TOKEN,
    owner_id: 'admin_1',
    owner_label: 'Test admin',
    acquired_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 900_000).toISOString(),
  },
  history: [],
  version: 2,
  ...overrides,
});

const seedRecord = async (store: Store, record: ReturnType<typeof makeRecord>) => {
  await store.setJSON(RECORD_KEY, record);
};

describe('updateAdminNode — expected_record_version enforcement', () => {
  it('returns 409 with current_version and writes nothing when the version is stale', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord());

    const res = await updateAdminNode(
      store,
      {
        requestId: REQUEST_ID,
        lockToken: LOCK_TOKEN,
        nodeId: 'n_hero',
        updatedPublicFields: { title: 'Stale update' },
        expected_record_version: 1,
      },
      ACTOR
    );

    assert.equal(res.statusCode, 409, res.body);
    const body = parseBody(res);
    assert.equal(body.conflict, true);
    assert.equal(body.current_version, 2);

    const saved = JSON.parse((await store.get(RECORD_KEY)) ?? '{}') as {
      input: { content: { article_body: { nodes: Array<{ public: { title?: string } }> } } };
      version: number;
    };
    assert.equal(saved.version, 2, 'a stale write must not mutate the record');
    assert.equal(saved.input.content.article_body.nodes[0].public.title, 'Original title');
  });

  it('updates the node and increments the version when expected_record_version matches', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord());

    const res = await updateAdminNode(
      store,
      {
        requestId: REQUEST_ID,
        lockToken: LOCK_TOKEN,
        nodeId: 'n_hero',
        updatedPublicFields: { title: 'Updated title' },
        expected_record_version: 2,
      },
      ACTOR
    );

    assert.equal(res.statusCode, 200, res.body);
    assert.equal(parseBody(res).version, 3);

    const saved = JSON.parse((await store.get(RECORD_KEY)) ?? '{}') as {
      input: { content: { article_body: { nodes: Array<{ public: { title?: string; body?: string } }> } } };
      version: number;
    };
    assert.equal(saved.version, 3);
    assert.equal(saved.input.content.article_body.nodes[0].public.title, 'Updated title');
    assert.equal(saved.input.content.article_body.nodes[0].public.body, 'Original body.');
  });

  it('still enforces the lock before the version check', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord());

    const res = await updateAdminNode(
      store,
      {
        requestId: REQUEST_ID,
        lockToken: 'wrong-token',
        nodeId: 'n_hero',
        updatedPublicFields: { title: 'Should fail' },
        expected_record_version: 2,
      },
      ACTOR
    );

    assert.equal(res.statusCode, 423, res.body);
    const body = parseBody(res);
    assert.equal(body.error, 'lock_mismatch');
    assert.equal((body.lock as Record<string, unknown> | undefined)?.token, undefined);
  });
});
