import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkoutRequest,
  createRequest,
  getRequest,
  patchAgentOutput,
  patchCanonicalInput,
  setPublishedTime,
  type WorkflowRecord,
} from '../../netlify/functions/save-json-blob.js';

// ---------------------------------------------------------------------------
// In-memory blob store (same shape used by all save-json-blob tests).
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
type ParsedBody = { error?: string; error_code?: string; not_found?: boolean; record?: WorkflowRecord };
const parseBody = (r: { body: string }): ParsedBody => JSON.parse(r.body) as ParsedBody;

const VALID_ID = 'req_publish_drlurie_20260702_01';
const UUID_ID = 'b7c4a1e2-1234-5678-9abc-def012345678';
const FORMAT_HINT_RE = /req_<flow>_<topic>_<yyyymmdd>_<nn>/;

const makeInput = () => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    title: 'Request ID Format Article',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [{ id: 'n_hero', kind: 'content', public: { title: 'Hero', body: 'Visible copy.' } }],
    },
  },
  publication: { schema_version: 'publication.v2', published_time: null },
  workflow: { schema_version: 'content_workflow.v1', workflow_id: VALID_ID },
});

// ===========================================================================
// create_request
// ===========================================================================

describe('requireRequestId — create_request format enforcement', () => {
  it('accepts a conforming req_<flow>_<topic>_<yyyymmdd>_<nn> id (no regression)', async () => {
    const store = createMemoryStore();
    const resp = await createRequest(store, {
      action: 'create_request',
      request_id: VALID_ID,
      input: makeInput(),
    });
    assert.equal(resp.statusCode, 201, resp.body);
    assert.equal(parseBody(resp).record?.request_id, VALID_ID);
  });

  it('rejects a UUID-style id with a 400 format hint', async () => {
    const store = createMemoryStore();
    const resp = await createRequest(store, {
      action: 'create_request',
      request_id: UUID_ID,
      input: makeInput(),
    });
    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', FORMAT_HINT_RE);
  });

  it('rejects a missing id with the existing "required" 400 (behavior preserved)', async () => {
    const store = createMemoryStore();
    const resp = await createRequest(store, {
      action: 'create_request',
      input: makeInput(),
    } as never);
    assert.equal(resp.statusCode, 400, resp.body);
    assert.equal(parseBody(resp).error, 'request_id is required.');
  });
});

// ===========================================================================
// All other workflow actions reject a UUID id BEFORE touching the record
// (400 format hint, not a 404 or a silent later failure).
// ===========================================================================

describe('requireRequestId — format enforced at every workflow action', () => {
  const cases: Array<{ name: string; run: (store: Store) => Promise<{ statusCode: number; body: string }> }> = [
    {
      name: 'get_request',
      run: (store) => getRequest(store, { action: 'get_request', request_id: UUID_ID }),
    },
    {
      name: 'checkout_request',
      run: (store) =>
        checkoutRequest(store, {
          action: 'checkout_request',
          request_id: UUID_ID,
          owner_id: 'agent',
          owner_label: 'Agent',
          lease_seconds: 900,
        }),
    },
    {
      name: 'patch_agent_output (update_output)',
      run: (store) =>
        patchAgentOutput(store, {
          action: 'patch_agent_output',
          request_id: UUID_ID,
          agent_name: 'final_article',
          expected_agent_version: 0,
          lock_token: 'lock_x',
          output: { artifactReferences: [] },
        }),
    },
    {
      name: 'patch_canonical_input',
      run: (store) =>
        patchCanonicalInput(store, {
          action: 'patch_canonical_input',
          request_id: UUID_ID,
          lock_token: 'lock_x',
          expected_record_version: 1,
          node_patches: [{ node_id: 'n_hero', public_media_src: null }],
        }),
    },
    {
      name: 'set_published_time',
      run: (store) =>
        setPublishedTime(store, {
          action: 'set_published_time',
          request_id: UUID_ID,
          lock_token: 'lock_x',
          published_time: '2026-07-02T10:00:00.000Z',
        }),
    },
  ];

  for (const { name, run } of cases) {
    it(`${name} rejects a UUID id with a 400 format hint (not a 404)`, async () => {
      const store = createMemoryStore();
      const resp = await run(store);
      assert.equal(resp.statusCode, 400, `${name}: ${resp.body}`);
      assert.match(parseBody(resp).error ?? '', FORMAT_HINT_RE, `${name} must return the format hint`);
      assert.notEqual(parseBody(resp).not_found, true, `${name} must fail on format, not fall through to a lookup`);
    });
  }
});
