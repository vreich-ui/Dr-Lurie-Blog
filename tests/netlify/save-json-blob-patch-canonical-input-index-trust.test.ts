import '../../src/config/policy-bindings.js'; // W11: register site providers (tests exercise the drlurie-bound core)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkoutRequest,
  createRequest,
  patchAgentOutput,
  patchCanonicalInput,
  type WorkflowRecord,
} from '../../netlify/functions/save-json-blob.js';
import { writeArtifactReferenceIndexes, type ArtifactIndexStore } from '../../packages/core/server/lib/artifact-index.js';
import type { ArtifactReference } from '../../packages/core/server/lib/artifacts.js';

// ---------------------------------------------------------------------------
// In-memory blob store (same shape used by all save-json-blob tests). Serves as
// both the workflow store and the artifact-index store.
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
type RecordBody = { ok?: boolean; error?: string; record?: WorkflowRecord };
const parseBody = (r: { body: string }): RecordBody => JSON.parse(r.body) as RecordBody;

// A request_id valid under the strict req_<flow>_<topic>_<yyyymmdd>_<nn> naming
// contract (required so the artifact blobKey passes isValidArtifactBlobKey).
const makeRequestId = (nn: number) => `req_repair_trustidx_20260702_${String(nn).padStart(2, '0')}`;

const hexSha = (fill: string) => fill.repeat(64);

/** Build a complete, valid ArtifactReference whose blobKey belongs to `requestId`. */
const makeImageRef = (
  requestId: string,
  fill: string,
  overrides: Partial<ArtifactReference> = {}
): ArtifactReference => {
  const sha256 = hexSha(fill);
  return {
    blobKey: `image/${requestId}/${sha256}.png`,
    sha256,
    sizeBytes: 12345,
    contentType: 'image/png',
    createdAtISO: '2026-07-02T00:00:00.000Z',
    artifactKind: 'image',
    ...overrides,
  };
};

const makeInput = (requestId: string) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    title: 'Trust Index Image',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [
        {
          id: 'n_hero',
          kind: 'content',
          public: {
            title: 'Hero image',
            media: {
              type: 'image',
              src: 'src/assets/images/uploads/trust-index-image/legacy-hero.webp',
              alt: 'Legacy hero',
            },
          },
        },
      ],
    },
  },
  publication: { schema_version: 'publication.v2', published_time: null },
  workflow: { schema_version: 'content_workflow.v1', workflow_id: requestId },
  versioning: { schema_version: 'versioning.v1', record_version: 1 },
});

/** Create + checkout a workflow record. Returns lock token and current record. */
const setupRecord = async (store: Store, requestId: string) => {
  const createResp = await createRequest(store, {
    action: 'create_request',
    request_id: requestId,
    input: makeInput(requestId),
  });
  assert.equal(createResp.statusCode, 201, createResp.body);

  const checkoutResp = await checkoutRequest(store, {
    action: 'checkout_request',
    request_id: requestId,
    owner_id: 'publishing_conductor',
    owner_label: 'Publishing Conductor',
    lease_seconds: 900,
  });
  assert.equal(checkoutResp.statusCode, 200, checkoutResp.body);
  const record = parseBody(checkoutResp).record!;
  return { lockToken: record.lock!.token, record };
};

const patchHeroSrc = (
  store: Store,
  indexStore: ArtifactIndexStore | undefined,
  requestId: string,
  lockToken: string,
  version: number,
  src: string | null
) =>
  patchCanonicalInput(
    store,
    {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: version,
      node_patches: [{ node_id: 'n_hero', public_media_src: src }],
    },
    indexStore
  );

// ===========================================================================
// Tests
// ===========================================================================

describe('patchCanonicalInput — artifact-index trust (same-request)', () => {
  it('ACCEPTS an image that exists only in the artifact index store (not in agent_outputs)', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore();
    const requestId = makeRequestId(1);
    const ref = makeImageRef(requestId, 'a');
    await writeArtifactReferenceIndexes(indexStore, requestId, ref);

    const { lockToken, record } = await setupRecord(store, requestId);
    // Sanity: the image is NOT present in any agent_outputs artifactReferences.
    assert.deepEqual(record.agent_outputs, {});

    const resp = await patchHeroSrc(store, indexStore, requestId, lockToken, record.version, ref.blobKey);

    assert.equal(resp.statusCode, 200, resp.body);
    const hero = parseBody(resp).record?.input.content?.article_body?.nodes?.find((n) => n.id === 'n_hero');
    assert.equal(hero?.public?.media?.src, ref.blobKey, 'hero src must be updated to the index-only artifact');
  });

  it('ACCEPTS an index-only image in promote_publish_payload.featuredImage', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore();
    const requestId = makeRequestId(2);
    const ref = makeImageRef(requestId, 'b');
    await writeArtifactReferenceIndexes(indexStore, requestId, ref);

    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchCanonicalInput(
      store,
      {
        action: 'patch_canonical_input',
        request_id: requestId,
        lock_token: lockToken,
        expected_record_version: record.version,
        promote_publish_payload: {
          slug: 'trust-index-image',
          title: 'Trust Index Image',
          author: 'Dr. Lurie',
          publishDate: '2026-07-02T10:00:00.000Z',
          overwrite: true,
          featuredImage: ref.blobKey,
        },
      },
      indexStore
    );

    assert.equal(resp.statusCode, 200, resp.body);
    const payload = parseBody(resp).record?.input.publication?.publish_payload as Record<string, unknown> | undefined;
    assert.equal(payload?.featuredImage, ref.blobKey);
  });

  it('REJECTS a soft-deleted artifact even though it exists in the index', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore();
    const requestId = makeRequestId(3);
    const deletedRef = makeImageRef(requestId, 'c', {
      deletedAtISO: '2026-07-02T01:00:00.000Z',
      deletedBy: 'admin',
    });
    await writeArtifactReferenceIndexes(indexStore, requestId, deletedRef);

    const { lockToken, record } = await setupRecord(store, requestId);

    const resp = await patchHeroSrc(store, indexStore, requestId, lockToken, record.version, deletedRef.blobKey);

    assert.equal(resp.statusCode, 400, resp.body);
    // The rejection must say WHY: the artifact exists but is soft-deleted.
    assert.match(parseBody(resp).error ?? '', /soft-deleted/);
    assert.match(parseBody(resp).error ?? '', new RegExp(deletedRef.blobKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('REJECTS a wrong-request pointer that does not resolve in the index', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore();
    const requestId = makeRequestId(4);
    // Index only holds THIS request's artifact.
    await writeArtifactReferenceIndexes(indexStore, requestId, makeImageRef(requestId, 'a'));

    const { lockToken, record } = await setupRecord(store, requestId);

    // A well-formed Major Key ref owned by a different request, absent from the index.
    const otherRequestRef = `image/req_other_flow_topic_20260702_09/${hexSha('d')}.png`;

    const resp = await patchHeroSrc(store, indexStore, requestId, lockToken, record.version, otherRequestRef);

    assert.equal(resp.statusCode, 400, resp.body);
    // The rejection must say WHY: the blobKey belongs to a different request.
    assert.match(parseBody(resp).error ?? '', /belongs to request 'req_other_flow_topic_20260702_09'/);
    assert.match(parseBody(resp).error ?? '', /Cross-request artifact references are not accepted/);
  });

  it('REJECTS malformed, base64 data-URI, and remote-URL values (existing behavior preserved)', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore();
    const requestId = makeRequestId(5);
    await writeArtifactReferenceIndexes(indexStore, requestId, makeImageRef(requestId, 'a'));
    const { lockToken, record } = await setupRecord(store, requestId);

    const base64 = await patchHeroSrc(
      store,
      indexStore,
      requestId,
      lockToken,
      record.version,
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    );
    assert.equal(base64.statusCode, 400, base64.body);
    assert.match(parseBody(base64).error ?? '', /data URI/);

    const remote = await patchHeroSrc(
      store,
      indexStore,
      requestId,
      lockToken,
      record.version,
      'https://cdn.example.com/hero.png'
    );
    assert.equal(remote.statusCode, 400, remote.body);
    assert.match(parseBody(remote).error ?? '', /remote URL/);

    const malformed = await patchHeroSrc(
      store,
      indexStore,
      requestId,
      lockToken,
      record.version,
      'image/not-a-real-ref'
    );
    assert.equal(malformed.statusCode, 400, malformed.body);
    assert.match(parseBody(malformed).error ?? '', /Major Key artifact reference/);
  });

  it('still ACCEPTS an agent_outputs ref when the index is empty (backward compatible)', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore(); // deliberately empty
    const requestId = makeRequestId(6);
    const ref = makeImageRef(requestId, 'a');

    const { lockToken } = await setupRecord(store, requestId);
    // Put the ref into agent_outputs.final_article only.
    const patched = await patchAgentOutput(store, {
      action: 'patch_agent_output',
      request_id: requestId,
      agent_name: 'final_article',
      expected_agent_version: 0,
      lock_token: lockToken,
      output: { artifactReferences: [ref] },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    const version = parseBody(patched).record!.version;

    const resp = await patchHeroSrc(store, indexStore, requestId, lockToken, version, ref.blobKey);

    assert.equal(resp.statusCode, 200, resp.body);
    const hero = parseBody(resp).record?.input.content?.article_body?.nodes?.find((n) => n.id === 'n_hero');
    assert.equal(hero?.public?.media?.src, ref.blobKey);
  });

  it('REJECTS an index-only ref when no index store is supplied (agent_outputs-only fallback)', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore();
    const requestId = makeRequestId(7);
    const ref = makeImageRef(requestId, 'a');
    await writeArtifactReferenceIndexes(indexStore, requestId, ref);

    const { lockToken, record } = await setupRecord(store, requestId);

    // No index store passed → only agent_outputs is consulted → not trusted.
    const resp = await patchCanonicalInput(store, {
      action: 'patch_canonical_input',
      request_id: requestId,
      lock_token: lockToken,
      expected_record_version: record.version,
      node_patches: [{ node_id: 'n_hero', public_media_src: ref.blobKey }],
    });

    assert.equal(resp.statusCode, 400, resp.body);
    assert.match(parseBody(resp).error ?? '', /not in the artifact index for request/);
  });
});
