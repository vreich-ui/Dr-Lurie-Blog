import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleSetPublishedTime, handlePatchCanonicalInput } from '../../netlify/functions/admin-patch-workflow.js';

// ---------------------------------------------------------------------------
// In-memory blob store
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

const LOCK_TOKEN = 'tok_test_abc123';
const REQUEST_ID = 'req_test_preserve';
const RECORD_KEY = `workflows/by-id/${REQUEST_ID}.json`;

const makeLock = (offsetMs = 900_000) => ({
  token: LOCK_TOKEN,
  owner_id: 'admin_test',
  owner_label: 'Test admin',
  acquired_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + offsetMs).toISOString(),
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
  input: {
    record_type: 'content_source',
    schema_version: 'content_source.v1',
    content: { title: 'Test Article' },
    publication: {
      schema_version: 'publication.v2',
      publish_payload: { slug: 'test-article', title: 'Test Article' },
      published_time: null,
    },
  },
  agent_outputs: {},
  lock: makeLock(),
  history: [],
  version: 1,
  ...overrides,
});

// Seed a record into the store and return it
const seedRecord = async (store: Store, record: ReturnType<typeof makeRecord>) => {
  await store.setJSON(RECORD_KEY, record);
};

// ---------------------------------------------------------------------------
// set_published_time tests
// ---------------------------------------------------------------------------
describe('handleSetPublishedTime', () => {
  it('sets published_time on the record', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord());

    const publishedTime = '2026-06-26T17:00:00.000Z';
    const res = await handleSetPublishedTime(store, {
      action: 'set_published_time',
      request_id: REQUEST_ID,
      lock_token: LOCK_TOKEN,
      published_time: publishedTime,
    });

    assert.equal(res.statusCode, 200);
    const saved = JSON.parse((await store.get(RECORD_KEY)) ?? '{}') as {
      input: { publication: { published_time: string; publish_payload: unknown } };
      version: number;
    };
    assert.equal(saved.input.publication.published_time, publishedTime);
  });

  it('preserves existing publish_payload when setting published_time', async () => {
    const store = createMemoryStore();
    const record = makeRecord();
    await seedRecord(store, record);

    const res = await handleSetPublishedTime(store, {
      action: 'set_published_time',
      request_id: REQUEST_ID,
      lock_token: LOCK_TOKEN,
      published_time: '2026-06-26T17:00:00.000Z',
    });

    assert.equal(res.statusCode, 200);
    const saved = JSON.parse((await store.get(RECORD_KEY)) ?? '{}') as {
      input: { publication: { publish_payload: unknown; published_time: string } };
    };
    // publish_payload must survive the set_published_time write
    assert.deepEqual(saved.input.publication.publish_payload, { slug: 'test-article', title: 'Test Article' });
    assert.equal(saved.input.publication.published_time, '2026-06-26T17:00:00.000Z');
  });

  it('returns 423 when lock token does not match', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord());

    const res = await handleSetPublishedTime(store, {
      action: 'set_published_time',
      request_id: REQUEST_ID,
      lock_token: 'wrong_token',
      published_time: '2026-06-26T17:00:00.000Z',
    });

    assert.equal(res.statusCode, 423);
    assert.equal(parseBody(res).error, 'lock_mismatch');
  });

  it('returns 423 when lock is expired', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord({ lock: { ...makeLock(-1000) } }));

    const res = await handleSetPublishedTime(store, {
      action: 'set_published_time',
      request_id: REQUEST_ID,
      lock_token: LOCK_TOKEN,
      published_time: '2026-06-26T17:00:00.000Z',
    });

    assert.equal(res.statusCode, 423);
    assert.equal(parseBody(res).lock_expired, true);
  });

  it('returns 404 when record does not exist', async () => {
    const store = createMemoryStore();

    const res = await handleSetPublishedTime(store, {
      action: 'set_published_time',
      request_id: 'req_nonexistent',
      lock_token: LOCK_TOKEN,
      published_time: '2026-06-26T17:00:00.000Z',
    });

    assert.equal(res.statusCode, 404);
  });
});

// ---------------------------------------------------------------------------
// handlePatchCanonicalInput — promote_publish_payload
// ---------------------------------------------------------------------------
describe('handlePatchCanonicalInput', () => {
  it('returns 400 when promote_publish_payload is missing', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord());

    const res = await handlePatchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: REQUEST_ID,
      lock_token: LOCK_TOKEN,
    });

    assert.equal(res.statusCode, 400);
    assert.match(String(parseBody(res).error), /promote_publish_payload is required/);
  });

  it('returns 409 when expected_record_version mismatches', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord());

    const res = await handlePatchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: REQUEST_ID,
      lock_token: LOCK_TOKEN,
      expected_record_version: 99,
      promote_publish_payload: { slug: 'test-article', title: 'Test Article' },
    });

    assert.equal(res.statusCode, 409);
    assert.equal(parseBody(res).conflict, true);
  });

  it('accepts promote_publish_payload with trusted PDF artifactReference', async () => {
    const store = createMemoryStore();
    const pdfSha = 'e'.repeat(64);
    const pdfArtifact = `pdf/${REQUEST_ID}/${pdfSha}.pdf`;
    await seedRecord(
      store,
      makeRecord({
        agent_outputs: {
          final_article: {
            version: 1,
            updated_at: new Date().toISOString(),
            expected_agent_version: 0,
            output: {
              artifactReferences: [
                {
                  blobKey: pdfArtifact,
                  sha256: pdfSha,
                  contentType: 'application/pdf',
                  artifactKind: 'pdf',
                  sizeBytes: 120000,
                  createdAtISO: new Date().toISOString(),
                },
              ],
            },
          },
        },
      })
    );

    const res = await handlePatchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: REQUEST_ID,
      lock_token: LOCK_TOKEN,
      expected_record_version: 1,
      promote_publish_payload: {
        slug: 'test-article',
        title: 'Test Article',
        artifactReferences: [
          {
            blobKey: pdfArtifact,
            sha256: pdfSha,
            contentType: 'application/pdf',
            artifactKind: 'pdf',
            sizeBytes: 120000,
            createdAtISO: new Date().toISOString(),
          },
        ],
      },
    });

    assert.equal(res.statusCode, 200, res.body);
  });

  it('saves publish_payload and increments version', async () => {
    const store = createMemoryStore();
    await seedRecord(store, makeRecord());

    const payload = { slug: 'updated-slug', title: 'Updated Title', excerpt: 'New excerpt.' };
    const res = await handlePatchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: REQUEST_ID,
      lock_token: LOCK_TOKEN,
      expected_record_version: 1,
      promote_publish_payload: payload,
    });

    assert.equal(res.statusCode, 200);
    const saved = JSON.parse((await store.get(RECORD_KEY)) ?? '{}') as {
      input: { publication: { publish_payload: unknown } };
      version: number;
    };
    assert.deepEqual(saved.input.publication.publish_payload, payload);
    assert.equal(saved.version, 2);
  });
});
