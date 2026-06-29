import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkoutRequest,
  createRequest,
  patchAgentOutput,
  type WorkflowRecord,
} from '../../netlify/functions/save-json-blob.js';

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
type ParsedBody = { ok?: boolean; error?: string; error_code?: string; record?: WorkflowRecord };
const parseBody = (r: { body: string }): ParsedBody => JSON.parse(r.body) as ParsedBody;

// ---------------------------------------------------------------------------
// Known stable artifact references
// ---------------------------------------------------------------------------
const REQUEST_ID = 'req_patch_agent_output_artifact_test_v1';
const VALID_SHA256_A = 'a'.repeat(64);
const VALID_SHA256_B = 'b'.repeat(64);
const VALID_BLOB_KEY_A = `image/${REQUEST_ID}/${VALID_SHA256_A}.png`;
const VALID_BLOB_KEY_B = `image/${REQUEST_ID}/${VALID_SHA256_B}.jpg`;

const validRef = (sha256: string, blobKey: string) => ({
  blobKey,
  sha256,
  sizeBytes: 150000,
  contentType: 'image/png',
  createdAtISO: '2026-06-29T00:00:00.000Z',
});

// ---------------------------------------------------------------------------
// Minimal content_source.v1 input
// ---------------------------------------------------------------------------
const makeInput = () => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    title: 'Artifact Contract Test Article',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [{ id: 'n_hero', kind: 'content', public: { title: 'Hero section', body: 'Visible copy.' } }],
    },
  },
  publication: { schema_version: 'publication.v2', published_time: null },
  workflow: { schema_version: 'content_workflow.v1', workflow_id: REQUEST_ID },
});

// ---------------------------------------------------------------------------
// Helper: create record and checkout
// ---------------------------------------------------------------------------
const createAndCheckout = async (store: Store, requestId: string) => {
  const createResp = await createRequest(store, {
    action: 'create_request',
    request_id: requestId,
    input: makeInput(),
  });
  assert.equal(createResp.statusCode, 201, createResp.body);

  const checkoutResp = await checkoutRequest(store, {
    action: 'checkout_request',
    request_id: requestId,
    owner_id: 'test-agent',
    owner_label: 'Test Agent',
    lease_seconds: 900,
  });
  assert.equal(checkoutResp.statusCode, 200, checkoutResp.body);
  const lockToken = parseBody(checkoutResp).record!.lock!.token;
  return lockToken;
};

// ===========================================================================
// Tests
// ===========================================================================

describe('patchAgentOutput — final_article artifactReferences contract', () => {
  it('accepts valid artifactReferences and stores them verbatim so publish can read them', async () => {
    const store = createMemoryStore();
    const requestId = `artifact-valid-${Date.now()}`;
    const lockToken = await createAndCheckout(store, requestId);

    const refs = [validRef(VALID_SHA256_A, VALID_BLOB_KEY_A), validRef(VALID_SHA256_B, VALID_BLOB_KEY_B)];

    const patchResp = await patchAgentOutput(store, {
      action: 'patch_agent_output',
      request_id: requestId,
      agent_name: 'final_article',
      expected_agent_version: 0,
      lock_token: lockToken,
      output: {
        article_body: {
          schema_version: 'article_body.v1',
          nodes: [{ id: 'n_hero', kind: 'content', public: { title: 'Final title', body: 'Final body.' } }],
        },
        artifactReferences: refs,
      },
    });

    assert.equal(patchResp.statusCode, 200, patchResp.body);

    const saved = parseBody(patchResp).record!;
    const storedOutput = saved.agent_outputs.final_article?.output as Record<string, unknown>;
    assert.ok(storedOutput, 'final_article output must be present in stored record');

    // Confirm publish pipeline can read the refs: output.artifactReferences is a top-level array
    const storedRefs = storedOutput.artifactReferences as unknown[];
    assert.ok(Array.isArray(storedRefs), 'output.artifactReferences must be a top-level array');
    assert.equal(storedRefs.length, 2, 'both artifact refs must be stored');

    const firstRef = storedRefs[0] as Record<string, unknown>;
    assert.equal(firstRef.sha256, VALID_SHA256_A);
    assert.equal(firstRef.blobKey, VALID_BLOB_KEY_A);

    const secondRef = storedRefs[1] as Record<string, unknown>;
    assert.equal(secondRef.sha256, VALID_SHA256_B);
    assert.equal(secondRef.blobKey, VALID_BLOB_KEY_B);
  });

  it('rejects a final_article output patch with a malformed artifactReference (missing sha256)', async () => {
    const store = createMemoryStore();
    const requestId = `artifact-malformed-sha-${Date.now()}`;
    const lockToken = await createAndCheckout(store, requestId);

    const patchResp = await patchAgentOutput(store, {
      action: 'patch_agent_output',
      request_id: requestId,
      agent_name: 'final_article',
      expected_agent_version: 0,
      lock_token: lockToken,
      output: {
        artifactReferences: [
          {
            blobKey: VALID_BLOB_KEY_A,
            // sha256 intentionally omitted
            sizeBytes: 150000,
            contentType: 'image/png',
            createdAtISO: '2026-06-29T00:00:00.000Z',
          },
        ],
      },
    });

    assert.equal(patchResp.statusCode, 400, patchResp.body);
    const body = parseBody(patchResp);
    assert.equal(body.error_code, 'invalid_artifact_reference');
    assert.ok(typeof body.error === 'string' && body.error.includes('output.artifactReferences[0]'), body.error);
    assert.ok(body.error.includes('sha256'), body.error);
  });

  it('rejects a final_article output patch with a malformed artifactReference (invalid blobKey)', async () => {
    const store = createMemoryStore();
    const requestId = `artifact-bad-blobkey-${Date.now()}`;
    const lockToken = await createAndCheckout(store, requestId);

    const patchResp = await patchAgentOutput(store, {
      action: 'patch_agent_output',
      request_id: requestId,
      agent_name: 'final_article',
      expected_agent_version: 0,
      lock_token: lockToken,
      output: {
        artifactReferences: [
          {
            blobKey: 'image/invented/path.png', // doesn't match sha256 below
            sha256: VALID_SHA256_A,
            sizeBytes: 150000,
            contentType: 'image/png',
            createdAtISO: '2026-06-29T00:00:00.000Z',
          },
        ],
      },
    });

    assert.equal(patchResp.statusCode, 400, patchResp.body);
    const body = parseBody(patchResp);
    assert.equal(body.error_code, 'invalid_artifact_reference');
    assert.ok(typeof body.error === 'string' && body.error.includes('output.artifactReferences[0]'), body.error);
  });

  it('rejects a final_article output patch when artifactReferences is not an array', async () => {
    const store = createMemoryStore();
    const requestId = `artifact-not-array-${Date.now()}`;
    const lockToken = await createAndCheckout(store, requestId);

    const patchResp = await patchAgentOutput(store, {
      action: 'patch_agent_output',
      request_id: requestId,
      agent_name: 'final_article',
      expected_agent_version: 0,
      lock_token: lockToken,
      output: {
        // singular key — a common agent mistake; must be rejected, not silently ignored
        artifactReferences: validRef(VALID_SHA256_A, VALID_BLOB_KEY_A),
      },
    });

    assert.equal(patchResp.statusCode, 400, patchResp.body);
    const body = parseBody(patchResp);
    assert.equal(body.error_code, 'invalid_artifact_references');
    assert.ok(
      typeof body.error === 'string' && body.error.includes('artifactReferences must be an array'),
      body.error
    );
  });

  it('passes through non-final_article agents without checking artifactReferences shape', async () => {
    const store = createMemoryStore();
    const requestId = `artifact-draft-agent-${Date.now()}`;
    const lockToken = await createAndCheckout(store, requestId);

    // draft agent may put anything it wants in output without triggering validation
    const patchResp = await patchAgentOutput(store, {
      action: 'patch_agent_output',
      request_id: requestId,
      agent_name: 'draft',
      expected_agent_version: 0,
      lock_token: lockToken,
      output: {
        artifactReferences: { blobKey: 'invented', sha256: 'bad' }, // malformed but not final_article
      },
    });

    assert.equal(patchResp.statusCode, 200, patchResp.body);
  });
});
