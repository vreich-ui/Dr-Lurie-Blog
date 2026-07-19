import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkoutRequest,
  createRequest,
  patchCanonicalInput,
  type WorkflowRecord,
} from '../../netlify/functions/save-json-blob.js';
import { writeArtifactReferenceIndexes, type ArtifactIndexStore } from '../../netlify/lib/artifact-index.js';
import type { ArtifactReference } from '../../netlify/lib/artifacts.js';

// Replays the EXACT four failed-record shapes from the 2026-06-30..07-02 smoke
// runs (queue evidence, triaged 2026-07-19). All four records failed with
// "blobKey … not found in agent_outputs artifact indexes" even though the
// artifact WAS in the request artifact index — the pre-#327 trust source was
// agent_outputs only. #327 unified trust on the index union; these fixtures pin
// that against the real-world field shapes that broke:
//   1. node public.media.src                     (req_smoke_inline_only_20260702_01)
//   2. promote_publish_payload.featuredImage     (req_smoke_featured_only_20260702_01)
//   3. promote_publish_payload.mediaEntries[].src (req_smoke_inline_compare_20260702_01)
//   4. promote_publish_payload.artifactReferences[].blobKey (req_smoke_image_pdf_cta_20260702_01)

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
type ResponseBody = { ok?: boolean; error?: string; record?: WorkflowRecord };
const parseBody = (r: { body: string }): ResponseBody => JSON.parse(r.body) as ResponseBody;

// The real sha256 from the failed req_smoke_image_pdf_cta_20260702_01 record.
const SMOKE_SHA = '5af8f3c2cc80d862b3b8f7a361baa56467dd9ed96aafe5ce1b8b7e6e9eb829b4';

const makeImageRef = (requestId: string, sha256: string): ArtifactReference => ({
  blobKey: `image/${requestId}/${sha256}.png`,
  sha256,
  sizeBytes: 54321,
  contentType: 'image/png',
  createdAtISO: '2026-07-02T00:00:00.000Z',
  artifactKind: 'image',
});

const makeInput = (requestId: string) => ({
  record_type: 'content_source',
  schema_version: 'content_source.v1',
  content: {
    title: 'Trust replay',
    article_body: {
      schema_version: 'article_body.v1',
      nodes: [
        { id: 'n_a7c1f2', kind: 'content', public: { title: 'Hero', body: 'Opening copy.' } },
        { id: 'n_body1', kind: 'content', public: { body: 'Some body copy.' } },
      ],
    },
  },
  publication: { schema_version: 'publication.v2', published_time: null },
  workflow: { schema_version: 'content_workflow.v1', workflow_id: requestId },
});

// Index-trusted only: the artifact reference is written to the request's
// artifact index (what list_artifacts_for_request reads) but NOT into any
// agent_outputs.artifactReferences — the exact situation the four smokes hit.
const setupRecordWithIndexedArtifact = async (store: Store, indexStore: ArtifactIndexStore, requestId: string) => {
  await writeArtifactReferenceIndexes(indexStore, requestId, makeImageRef(requestId, SMOKE_SHA));

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

describe('class-3 replay: index-trusted (not in agent_outputs) refs are accepted in all four failed shapes', () => {
  it('shape 1 — node public.media.src (req_smoke_inline_only)', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore() as unknown as ArtifactIndexStore;
    const requestId = 'req_smoke_inline_only_20260702_01';
    const { lockToken, record } = await setupRecordWithIndexedArtifact(store, indexStore, requestId);

    const resp = await patchCanonicalInput(
      store,
      {
        action: 'patch_canonical_input',
        request_id: requestId,
        lock_token: lockToken,
        expected_record_version: record.version,
        node_patches: [
          { node_id: 'n_a7c1f2', public_media_src: `image/${requestId}/${SMOKE_SHA}.png`, public_media_alt: 'Alt' },
        ],
      },
      indexStore
    );
    assert.equal(resp.statusCode, 200, resp.body);
  });

  it('shape 2 — promote_publish_payload.featuredImage (req_smoke_featured_only)', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore() as unknown as ArtifactIndexStore;
    const requestId = 'req_smoke_featured_only_20260702_01';
    const { lockToken, record } = await setupRecordWithIndexedArtifact(store, indexStore, requestId);

    const resp = await patchCanonicalInput(
      store,
      {
        action: 'patch_canonical_input',
        request_id: requestId,
        lock_token: lockToken,
        expected_record_version: record.version,
        promote_publish_payload: {
          slug: 'trust-replay-featured-only',
          title: 'Trust replay',
          featuredImage: `image/${requestId}/${SMOKE_SHA}.png`,
        },
      },
      indexStore
    );
    assert.equal(resp.statusCode, 200, resp.body);
  });

  it('shape 3 — promote_publish_payload.mediaEntries[].src (req_smoke_inline_compare)', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore() as unknown as ArtifactIndexStore;
    const requestId = 'req_smoke_inline_compare_20260702_01';
    const { lockToken, record } = await setupRecordWithIndexedArtifact(store, indexStore, requestId);

    const resp = await patchCanonicalInput(
      store,
      {
        action: 'patch_canonical_input',
        request_id: requestId,
        lock_token: lockToken,
        expected_record_version: record.version,
        promote_publish_payload: {
          slug: 'trust-replay-inline-compare',
          title: 'Trust replay',
          mediaEntries: [{ src: `image/${requestId}/${SMOKE_SHA}.png`, alt: 'Inline image' }],
        },
      },
      indexStore
    );
    assert.equal(resp.statusCode, 200, resp.body);
  });

  it('shape 4 — promote_publish_payload.artifactReferences[].blobKey (req_smoke_image_pdf_cta)', async () => {
    const store = createMemoryStore();
    const indexStore = createMemoryStore() as unknown as ArtifactIndexStore;
    const requestId = 'req_smoke_image_pdf_cta_20260702_01';
    const { lockToken, record } = await setupRecordWithIndexedArtifact(store, indexStore, requestId);

    const resp = await patchCanonicalInput(
      store,
      {
        action: 'patch_canonical_input',
        request_id: requestId,
        lock_token: lockToken,
        expected_record_version: record.version,
        promote_publish_payload: {
          slug: 'trust-replay-image-pdf-cta',
          title: 'Trust replay',
          artifactReferences: [makeImageRef(requestId, SMOKE_SHA)],
        },
      },
      indexStore
    );
    assert.equal(resp.statusCode, 200, resp.body);
  });
});
