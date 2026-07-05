import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { saveAdminJsonDraft } from '../../netlify/functions/admin-save-json-draft.js';

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

const LOCK_TOKEN = 'tok_draft_test';
const REQUEST_ID = 'req_test_admin_draft';
const RECORD_KEY = `workflows/by-id/${REQUEST_ID}.json`;

const draftInput = () => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    title: 'Draft coverage article',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [{ id: 'n_draft', kind: 'content', public: { body: 'Visible draft body.' } }],
    },
  },
  publication: { schema_version: 'publication.v2', published_time: null },
});

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
  input: draftInput(),
  agent_outputs: {},
  lock: {
    token: LOCK_TOKEN,
    owner_id: 'admin_1',
    owner_label: 'Test admin',
    acquired_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 900_000).toISOString(),
  },
  history: [],
  version: 4,
  ...overrides,
});

const seedRecord = async (store: Store, record: ReturnType<typeof makeRecord>) => {
  await store.setJSON(RECORD_KEY, record);
};

describe('saveAdminJsonDraft — expected_record_version enforcement on updates', () => {
  it('returns 400 when expected_record_version is missing on an update', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord());

    const res = await saveAdminJsonDraft(store, {
      request_id: REQUEST_ID,
      lock_token: LOCK_TOKEN,
      input: draftInput(),
    });

    assert.equal(res.statusCode, 400, res.body);
    const body = parseBody(res);
    assert.equal(body.error_code, 'missing_expected_record_version');
    assert.match(String(body.error), /expected_record_version is required when updating/);
  });

  it('returns 409 with current_version and writes nothing when the version is stale', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord());

    const res = await saveAdminJsonDraft(store, {
      request_id: REQUEST_ID,
      lock_token: LOCK_TOKEN,
      expected_record_version: 3,
      input: draftInput(),
    });

    assert.equal(res.statusCode, 409, res.body);
    const body = parseBody(res);
    assert.equal(body.conflict, true);
    assert.equal(body.current_version, 4);

    const saved = JSON.parse((await store.get(RECORD_KEY)) ?? '{}') as { version: number };
    assert.equal(saved.version, 4, 'a stale write must not mutate the record');
  });

  it('updates the draft and increments the version when expected_record_version matches', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord());

    const res = await saveAdminJsonDraft(store, {
      request_id: REQUEST_ID,
      lock_token: LOCK_TOKEN,
      expected_record_version: 4,
      input: draftInput(),
    });

    assert.equal(res.statusCode, 200, res.body);

    const saved = JSON.parse((await store.get(RECORD_KEY)) ?? '{}') as { version: number };
    assert.equal(saved.version, 5);
  });

  it('draft creation (no request_id) does not require expected_record_version', async () => {
    const store = createMemoryStore();

    const res = await saveAdminJsonDraft(store, { input: draftInput() });

    assert.equal(res.statusCode, 201, res.body);
    const body = parseBody(res);
    assert.equal(body.created, true);
    assert.equal((body.record as { version?: number } | undefined)?.version, 1);
  });
});
